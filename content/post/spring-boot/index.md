---
title: "Spring Boot 核心原理与最佳实践"
description: "从自动配置到启动流程，理解 Spring Boot 的魔法背后"
date: 2026-07-19
slug: "spring-boot"
tags: ["Spring Boot", "自动配置", "内嵌容器"]
categories: ["Java"]
---

## 前言

Spring Boot 之所以"火"，在于它把 Spring 繁琐的配置变成了**约定大于配置**。你用 3 行代码就能跑起一个 Web 服务，背后是一整套自动配置体系在支撑。

> 面试重点：**自动配置原理**、**启动流程**、**常用 Starter**。

---

## 一、最简示例

```java
@SpringBootApplication  // 这是一个组合注解
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

@RestController
public class HelloController {
    @GetMapping("/hello")
    public String hello() {
        return "Hello Spring Boot!";
    }
}
```

一分钟启动，搞定一个 HTTP 接口。

---

## 二、@SpringBootApplication 源码级拆解

### 2.1 组合注解

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@SpringBootConfiguration      // 等同于 @Configuration（声明配置类）
@EnableAutoConfiguration      // 开启自动配置（核心）
@ComponentScan(excludeFilters = { ... })  // 扫描当前包及子包
public @interface SpringBootApplication { ... }
```

**三个核心注解：**

| 注解 | 作用 |
|------|------|
| `@SpringBootConfiguration` | 标记此为主配置类，本质是 @Configuration |
| `@EnableAutoConfiguration` | 开启自动配置机制（核心）|
| `@ComponentScan` | 默认扫描启动类所在包及其子包的 @Component |

---

## 三、自动配置原理（核心重点）

### 3.1 它是怎么知道要配什么的？

**@EnableAutoConfiguration 源码：**

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Import(AutoConfigurationImportSelector.class)  // 关键！
public @interface EnableAutoConfiguration { ... }
```

**AutoConfigurationImportSelector** 会做一件事：

```
读取 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports 文件
  ↓
里面列出了所有自动配置类（Spring Boot 内部提供的）
  ↓
Filter 过滤掉不需要的（通过 @Conditional 条件判断）
  ↓
注册符合条件的配置类 → 生成对应的 Bean
```

看 `spring-boot-autoconfigure` 包里的该文件内容节选：

```
org.springframework.boot.autoconfigure.web.servlet.DispatcherServletAutoConfiguration
org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration
org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration
...
```

### 3.2 @Conditional — 条件装配

```java
@Configuration
// 只有引入 H2 数据库的依赖时才生效
@ConditionalOnClass(H2Database.class)
// 只有没有自定义 DataSource 时才生效
@ConditionalOnMissingBean(DataSource.class)
public class DataSourceAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean
    public DataSource dataSource() {
        // 自动配置一个默认的 DataSource
        return new HikariDataSource();
    }
}
```

**常用条件注解：**

| 注解 | 生效条件 |
|------|---------|
| @ConditionalOnClass | 类路径存在指定类 |
| @ConditionalOnMissingClass | 类路径不存在指定类 |
| @ConditionalOnBean | 容器中存在指定 Bean |
| @ConditionalOnMissingBean | 容器中不存在指定 Bean |
| @ConditionalOnProperty | 配置文件中存在指定属性 |
| @ConditionalOnExpression | SpEL 表达式为 true |

### 3.3 自动配置示例：Redis

```xml
<!-- 只要引入依赖 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

```yaml
# 配一下连接信息
spring:
  redis:
    host: localhost
    port: 6379
```

然后就自动有了 `RedisTemplate`、`StringRedisTemplate` 可以直接注入使用。

**背后的自动配置类：**

```java
@Configuration
@ConditionalOnClass(RedisOperations.class)  // 引入依赖后才有这个类
@EnableConfigurationProperties(RedisProperties.class)  // 绑定配置项
public class RedisAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean(name = "redisTemplate")
    public RedisTemplate<Object, Object> redisTemplate(
            RedisConnectionFactory connectionFactory) {
        // 创建默认模板
        RedisTemplate<Object, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        return template;
    }
}
```

**为什么我自定义了 RedisTemplate 就不生效了？** 因为 `@ConditionalOnMissingBean` — 你已经有一个了，自动配置就不覆盖你。

---

## 四、Spring Boot 启动流程

```
SpringApplication.run()
  │
  ├─ 1. 推断应用类型（REACTIVE / SERVLET / NONE）
  │
  ├─ 2. 加载所有 SpringApplicationRunListener
  │     （监听启动事件，支持扩展）
  │
  ├─ 3. 获取并准备 Environment（环境变量 + 配置文件）
  │     → application.yml 会被加载到这里
  │
  ├─ 4. 创建 ApplicationContext
  │     → 如果是 Web 应用 → AnnotationConfigServletWebServerApplicationContext
  │     → 非 Web → AnnotationConfigApplicationContext
  │
  ├─ 5. 准备工作：注册启动类、设置 Environment
  │
  ├─ 6. refreshContext() → 这才是真正的 Spring 容器启动！
  │     ├─ BeanFactory 初始化
  │     ├─ 执行 BeanFactoryPostProcessor（扫描 + 解析配置）
  │     ├─ 注册 BeanPostProcessor
  │     ├─ 初始化 MessageSource
  │     ├─ 初始化事件广播器
  │     ├─ 注册监听器
  │     ├─ 实例化所有非懒加载单例 Bean（含自动配置）
  │     └─ 启动内嵌 Web 服务器（Tomcat）
  │
  └─ 7. 发布 ApplicationReadyEvent → 启动完成
```

> 核心步骤就是第6步 `refresh()`，这是 Spring Framework 的容器启动方法，Spring Boot 在它前、后加了自动配置和 Web 服务器启动。

---

## 五、内嵌 Web 容器

Spring Boot 默认内嵌 **Tomcat**（也可以换成 Jetty 或 Undertow）。

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <!-- 排除默认的 Tomcat -->
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-tomcat</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<!-- 换成 Undertow（性能比 Tomcat 高） -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-undertow</artifactId>
</dependency>
```

**内嵌容器怎么工作的？**

```java
// EmbeddedWebServerFactoryCustomizerAutoConfiguration 中
// 根据 classpath 是否存在 Tomcat/Jetty/Undertow 来决定创建哪种
@ConditionalOnClass(Tomcat.class)
public static class TomcatWebServerFactoryCustomizerConfiguration {
    @Bean
    public TomcatServletWebServerFactory tomcatServletWebServerFactory() {
        return new TomcatServletWebServerFactory();
    }
}
```

---

## 六、核心 Starter 一览

| Starter | 作用 |
|---------|------|
| spring-boot-starter-web | Web 开发（Tomcat + Spring MVC）|
| spring-boot-starter-data-jpa | JPA + Hibernate |
| spring-boot-starter-data-redis | Redis |
| spring-boot-starter-amqp | RabbitMQ |
| spring-boot-starter-validation | 参数校验（Hibernate Validator）|
| spring-boot-starter-test | 测试（JUnit + Mockito + AssertJ）|
| spring-boot-starter-actuator | 监控（健康检查、指标、审计）|

### yml 配置详解（按优先级排序）

```
1. 命令行参数：--server.port=8081
2. JNDI 属性
3. application-{profile}.yml（如 application-dev.yml）
4. application.yml
5. @PropertySource（如果有）
```

```yaml
server:
  port: 8080                    # 端口
  servlet:
    context-path: /api          # 上下文路径

spring:
  profiles:
    active: dev                 # 激活环境
  datasource:
    url: jdbc:mysql://localhost:3306/db
    username: root
    password: 123456
  jpa:
    hibernate:
      ddl-auto: update          # 自动建表
    show-sql: true
```

---

## 七、异常处理与最佳实践

### 7.1 统一异常处理

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBusiness(BusinessException e) {
        return Result.error(e.getCode(), e.getMessage());
    }
    
    @ExceptionHandler(Exception.class)
    public Result<Void> handleUnknown(Exception e) {
        log.error("未知异常", e);
        return Result.error(500, "服务器内部错误");
    }
}
```

### 7.2 分层架构

```
controller/       ← 接收请求、返回响应（很薄的一层）
service/          ← 业务逻辑
repository/dao/   ← 数据访问
dto/              ← 数据传输对象
entity/           ← 数据库实体
config/           ← 配置类
```

**阿里巴巴开发手册的规范**：
- Controller 层只做参数校验和结果封装
- Service 层做业务逻辑
- 避免在 Controller 里直接调用另一个 Service

### 7.3 配置管理

```yaml
# application-dev.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/dev_db

# application-prod.yml
spring:
  datasource:
    url: jdbc:mysql://prod-host:3306/prod_db
```

```bash
# 启动时指定环境
java -jar app.jar --spring.profiles.active=prod
```

---

## 面试重点速记

| 题目 | 要点 |
|------|------|
| 自动配置原理？ | @EnableAutoConfiguration → 加载 META-INF 文件 → @Conditional 按条件生效 |
| 启动流程？ | 推断应用类型→准备环境→创建容器→refresh()->启动内嵌 Tomcat→发布事件 |
| 内嵌 Web 容器？ | 默认 Tomcat，可换成 Jetty/Undertow |
| Condition 注解体系？ | @ConditionalOnClass / OnMissingBean / OnProperty 等 |
| application.yml 加载顺序？ | 命令行参数 > profile 配置 > 默认配置 > @PropertySource |
| Spring Boot 工程结构？ | controller / service / repository / dto / entity / config |
