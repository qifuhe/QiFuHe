---
title: "Spring 核心：IoC 与 AOP 源码级解析"
description: "控制反转、依赖注入、面向切面编程的原理与实践"
date: 2026-07-19
slug: "spring-ioc-aop"
tags: ["Spring", "IoC", "AOP", "依赖注入"]
categories: ["Java"]
---

## 前言

Spring 是 Java 后端开发的基石。面试必问的两个核心概念：**IoC（控制反转）** 和 **AOP（面向切面编程）**。

> 学会 Spring 的源码级理解，是面试和实际工作的分水岭。

---

## 一、IoC（控制反转）与 DI（依赖注入）

### 1.1 是什么

**不用 IoC 的做法：**

```java
public class UserService {
    private UserDao userDao = new UserDao(); // 自己 new，硬编码
}
```

**用了 Spring 的做法：**

```java
@Service
public class UserService {
    @Autowired
    private UserDao userDao; // 由 Spring 注入，对象什么时候创建、什么时候销毁不归我管
}
```

**控制反转**：对象创建和管理的控制权从程序员转交给 Spring 容器。
**依赖注入**：容器帮我们创建对象并注入到需要的地方（字段/构造器/Setter）。

### 1.2 Spring IoC 容器

容器管理所有 Bean 的生命周期：

```
启动 → 扫描 → 解析配置(注解/XML) → 定义BeanDefinition
    → 实例化Bean → 填充属性(依赖注入) → BeanPostProcessor前置处理
    → 初始化(InitializingBean/@PostConstruct) → BeanPostProcessor后置处理
    → 就绪(可使用) → 销毁(DisposableBean/@PreDestroy)
```

### 1.3 BeanFactory vs ApplicationContext

```java
// BeanFactory — 最底层容器（延迟加载）
BeanFactory factory = new XmlBeanFactory(new ClassPathResource("beans.xml"));
UserService userService = factory.getBean(UserService.class);

// ApplicationContext — 更常用（预加载+额外功能）
ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
UserService userService = ctx.getBean(UserService.class);
```

| | BeanFactory | ApplicationContext |
|---|---|---|
| Bean 加载 | 延迟（getBean时创建） | 默认预加载（scope=singleton）|
| 事件机制 | ❌ | ✅ 事件发布+监听 |
| 国际化 | ❌ | ✅ MessageSource |
| AOP 支持 | 需手动集成 | ✅ 自动支持 |
| 注解支持 | ❌ | ✅ @ComponentScan 等 |

### 1.4 Bean 的作用域

```java
@Component
@Scope("singleton")     // 默认：一个容器只有一个实例
public class UserService { }

@Scope("prototype")     // 每次 getBean 都是一个新的
@Scope("request")       // 每个 HTTP 请求一个（Web 应用）
@Scope("session")       // 每个 Session 一个（Web 应用）
```

**注意**：prototype 作用域的 Bean 在注入到 singleton Bean 时，每次获取的都是同一个。解决方式：

```java
// 方法一：方法注入（@Lookup）
@Component
@Scope("singleton")
public class SingleBean {
    @Lookup
    public PrototypeBean getPrototypeBean() { return null; }  // Spring会代理重写
}

// 方法二：ObjectFactory
@Autowired
private ObjectFactory<PrototypeBean> prototypeBeanFactory;
```

### 1.5 循环依赖（重点）

```java
@Service
public class AService {
    @Autowired
    private BService bService;
}

@Service
public class BService {
    @Autowired
    private AService aService;
}
```

**如果没三级缓存，这种就报错了。Spring 怎么解决的？**

**三级缓存**（DefaultSingletonBeanRegistry）：

```java
public class DefaultSingletonBeanRegistry {
    // 一级：完整创建好的单例（成品）
    private final Map<String, Object> singletonObjects = new ConcurrentHashMap<>(256);
    
    // 二级：提前暴露的、未完成初始化的 Bean（半成品）
    private final Map<String, Object> earlySingletonObjects = new HashMap<>(16);
    
    // 三级：ObjectFactory，生产二级缓存中的对象
    private final Map<String, ObjectFactory<?>> singletonFactories = new HashMap<>(16);
}
```

**解决流程（简化）：**

```
1. 创建 A → 实例化 A（调构造器，得到一个"半成品"A）
2. 将 A 放入三级缓存（singletonFactories），存的是 lambda：提前暴露 A 的引用
3. 填充 A 的属性：发现需要 B
4. 去容器找 B → 发现 B 还没创建 → 创建 B
5. 实例化 B（半成品）
6. 填充 B 的属性：发现需要 A
7. 从三级缓存拿到 A（通过工厂生成）→ 放入二级缓存 → B 拿到了 A 的引用（虽然 A 还没初始化完）
8. B 创建完成 → 放入一级缓存
9. 回到 A → 继续初始化 → 把完整 A 放入一级缓存
```

**关键条件**：
- 只解决 **singleton + 字段/Setter 注入** 的循环依赖
- **构造器注入** 的循环依赖无法解决（实例化时就卡住了）

---

## 二、AOP（面向切面编程）

### 2.1 核心概念

```
┌─ Aspect（切面）─────────────────────────────────┐
│  ┌─ Pointcut（切点）：WHERE — 哪些方法需要增强    │
│  │   execution(* com.example.service.*.*(..))    │
│  ├─ Advice（通知）：WHAT — 执行什么增强逻辑       │
│  │   @Before / @AfterReturning / @Around 等      │
│  ├─ JoinPoint（连接点）：WHEN — 方法执行时的某个时机 │
│  └─ Weaving（织入）：将切面应用到目标对象的过程    │
└─────────────────────────────────────────────────┘
```

### 2.2 使用示例

```java
@Aspect
@Component
public class LogAspect {
    
    @Around("execution(* com.example.service.*.*(..))")
    public Object logAround(ProceedingJoinPoint pjp) throws Throwable {
        // 前置
        long start = System.currentTimeMillis();
        log.info("调用: {}", pjp.getSignature());
        
        Object result = pjp.proceed(); // 执行目标方法
        
        // 后置
        long cost = System.currentTimeMillis() - start;
        log.info("耗时: {}ms", cost);
        return result;
    }
}
```

### 2.3 AOP 源码级理解 — 代理机制

AOP 底层是**代理模式**。Spring 会根据目标类是否实现接口，选择不同的代理方式：

```
目标类实现接口 → JDK 动态代理（反射+InvocationHandler）
目标类没有接口 → CGLIB 代理（字节码增强，生成子类）
```

**JDK 动态代理原理：**

```java
// 简化版源码逻辑
public class JdkDynamicAopProxy implements InvocationHandler {
    private Object target; // 目标对象
    
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        // 1. 执行 @Before 通知
        for (MethodInterceptor interceptor : advisors) {
            interceptor.invoke(/* ... */);
        }
        
        // 2. 执行目标方法
        Object result = method.invoke(target, args);
        
        // 3. 执行 @AfterReturning 通知
        return result;
    }
}
```

**CGLIB 原理**：
```
目标类 → CGLIB Enhancer → 生成目标类的子类
                           → 子类重写父类方法
                           → 重写的方法中加入拦截器链
```

> **注意**：CGLIB 通过继承实现，不能代理 final 类和方法。

### 2.4 Spring AOP 限制

Spring AOP 是**基于代理**的 AOP，==> **只能拦截 public 方法**。同一个类内部调用被拦截方法也不会生效：

```java
@Service
public class UserService {
    public void methodA() {
        this.methodB(); // 这个调用不会走 AOP 拦截！
        // 因为 this 是原始对象，不是代理对象
    }
    
    @Transactional
    public void methodB() { }
}
```

**解法**：
```java
// 方法一：注入自己（代理对象）
@Autowired
private UserService userService;

// 方法二：AopContext.currentProxy()
((UserService) AopContext.currentProxy()).methodB();
// 需要 @EnableAspectJAutoProxy(exposeProxy = true)

// 方法三：拆到不同 Service 中
```

> AspectJ（编译期织入）没有这个限制，因为它直接修改了字节码。

---

## 三、事务管理

### 3.1 @Transactional 原理

`@Transactional` 本质是 AOP 的应用：

```java
@Around("@annotation(transactional)")
public Object handleTransaction(ProceedingJoinPoint pjp) throws Throwable {
    // 1. 获取或创建事务
    TransactionStatus status = transactionManager.getTransaction(definition);
    try {
        Object result = pjp.proceed();  // 执行目标方法
        transactionManager.commit(status);  // 2. 提交
        return result;
    } catch (Exception e) {
        transactionManager.rollback(status);  // 3. 回滚
        throw e;
    }
}
```

### 3.2 事务传播行为

```java
@Transactional(propagation = Propagation.REQUIRED)  // 默认：有就用，没有就新建
@Transactional(propagation = Propagation.REQUIRES_NEW) // 每次新建事务
@Transactional(propagation = Propagation.NESTED)    // 内嵌事务（Savepoint）
@Transactional(propagation = Propagation.MANDATORY) // 必须有事务，没有就抛异常
```

**经典场景**：

```java
// REQUIRED — 日志和业务在同个事务，日志回滚业务也回滚
// REQUIRES_NEW — 日志单独事务，不管业务是否回滚，日志都记录
```

### 3.3 事务失效的常见原因

```java
1. @Transactional 加到 private 方法上（代理只能拦截 public）
2. 方法内部调用（this.xxx()，同上）
3. 异常被 catch 了没抛出去
4. 抛的异常不是 RuntimeException（默认只回滚 RuntimeException 和 Error）
   → @Transactional(rollbackFor = Exception.class)
5. 数据源没配置事务管理器
```

---

## 面试重点速记

| 题目 | 要点 |
|------|------|
| IoC 是什么？ | 对象创建控制权交给容器，DI 是 IoC 的实现方式 |
| Bean 生命周期？ | 实例化→填充属性→BeanPostProcessor→初始化→就绪→销毁 |
| 三级缓存解决什么？ | singleton + field/setter 注入的循环依赖 |
| AOP 底层原理？ | JDK 动态代理（有接口） / CGLIB（无接口）|
| AOP 哪些方法不拦截？ | private、内部 this 调用、final 方法 |
| 事务失效原因？ | private、内部调用、catch 未抛、异常类型不对 |
