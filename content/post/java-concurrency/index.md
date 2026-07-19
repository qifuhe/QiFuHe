---
title: "Java 并发编程：线程与锁深入浅出"
description: "面试必问的并发基础，从线程创建到锁机制源码级解析"
date: 2026-07-19
slug: "java-concurrency"
tags: ["Java", "并发", "线程", "锁"]
categories: ["Java"]
---

## 前言

并发编程是 Java 后端面试的"必考题"。这篇文章从 **线程** 和 **锁** 两个核心维度出发，涵盖实习生面试的高频考点，并适度深入源码帮助理解。

---

## 一、线程基础

### 1.1 创建线程的三种方式

```java
// 方式一：继承 Thread
class MyThread extends Thread {
    @Override
    public void run() {
        System.out.println("Thread running");
    }
}

// 方式二：实现 Runnable（推荐）
class MyTask implements Runnable {
    @Override
    public void run() {
        System.out.println("Task running");
    }
}

// 方式三：实现 Callable + FutureTask（带返回值）
class MyCallable implements Callable<String> {
    @Override
    public String call() {
        return "Result";
    }
}
```

**面试点：** Runnable 比 Thread 好在哪？
- Java 单继承，实现接口不影响继承其它类
- 解耦任务定义与执行方式
- 方便线程池复用

### 1.2 线程生命周期

```
NEW ──start()──→ RUNNABLE ──获取锁──→ BLOCKED
                      │                    │
                等待CPU调度            释放锁后回到RUNNABLE
                      │
                得到时间片 → RUNNING
                      │
              ┌───────┼───────┐
              ↓       ↓       ↓
          WAITING  TIMED_WAITING  TERMINATED
        (wait/join)  (sleep(ms))
```

所有状态在 Thread.State 枚举中定义（JDK 源码）：

```java
// 来自 OpenJDK Thread.java
public enum State {
    NEW,        // 新建，尚未start
    RUNNABLE,   // 可运行（就绪+运行合并）
    BLOCKED,    // 阻塞等待monitor锁
    WAITING,    // 等待（Object.wait, Thread.join, LockSupport.park）
    TIMED_WAITING, // 带超时的等待
    TERMINATED  // 已结束
}
```

---

## 二、synchronized 关键字

### 2.1 用法

```java
// 1. 修饰实例方法 → 锁的是 this
public synchronized void method() { }

// 2. 修饰静态方法 → 锁的是 Class 对象
public static synchronized void staticMethod() { }

// 3. 同步代码块 → 锁指定对象
public void block() {
    synchronized (this) {
        // 临界区
    }
}
```

### 2.2 底层原理（重点）

`synchronized` 在 JVM 中是通过 **Monitor**（监视器锁）实现的。

看字节码：

```java
public void method() {
    synchronized (this) {
        System.out.println("hello");
    }
}
```

反编译看关键字节码指令：

```
monitorenter  // 进入，尝试获取锁
...
monitorexit   // 退出，释放锁（正常路径）
monitorexit   // 退出，释放锁（异常路径，保证一定会释放）
```

> **JDK 6 之后的大优化：** 锁不再是"重量级"的。JVM 引入了**锁升级**机制。

### 2.3 锁升级（无锁 → 偏向锁 → 轻量级锁 → 重量级锁）

```
无锁 → 偏向锁 → 轻量级锁（自旋锁）→ 重量级锁
←——————————————————————————————→ 只能升级，不能降级
```

| 阶段 | 触发条件 | 开销 |
|------|---------|------|
| 偏向锁 | 只有一个线程访问同步块 | 极低，只在CAS一次 |
| 轻量级锁 | 少量线程交替获取，不竞争 | 自旋等待，不挂起 |
| 重量级锁 | 多线程真正竞争 | 线程挂起+唤醒，上下文切换 |

**面试高频题："synchronized 是重量级锁吗？"**
- 答：JDK 6 之后不再是。默认是偏向锁，只有真正多线程竞争时才会升级为重量级锁。

---

## 三、Lock 接口与实现

### 3.1 ReentrantLock

```java
Lock lock = new ReentrantLock(true); // fair = true 表示公平锁

lock.lock();
try {
    // 临界区
} finally {
    lock.unlock(); // 一定在finally中释放！
}
```

### 3.2 synchronized vs Lock

| 对比项 | synchronized | ReentrantLock |
|--------|-------------|---------------|
| 锁获取/释放 | 自动 | 手动（必须finally释放） |
| 可中断 | ❌ | ✅ lockInterruptibly() |
| 超时尝试 | ❌ | ✅ tryLock(timeout) |
| 公平性 | 非公平 | 可选公平/非公平 |
| 条件变量 | wait/notify | Condition（更灵活） |
| 性能 | 优化后≈Lock | 差不多 |

### 3.3 AQS（AbstractQueuedSynchronizer）源码级理解

`ReentrantLock` 的核心是 **AQS**，这是 Java 并发包的基石。

```java
// AQS 核心字段（简化理解）
public abstract class AbstractQueuedSynchronizer {
    // 核心：volatile 的 state
    // ReentrantLock 中，0=无锁，>0=持有锁（可重入计数）
    private volatile int state;
    
    // CLH 队列头尾（双向链表，存放等待线程）
    private transient Node head;
    private transient Node tail;
    
    // 独占模式：当前持有锁的线程
    private transient Thread exclusiveOwnerThread;
}
```

**加锁流程（非公平锁）：**

```
lock()
  ├─ CAS尝试设置 state=1（快速抢锁）
  │    ├─ 成功 → 设置 exclusiveOwnerThread = 当前线程
  │    └─ 失败 → acquire(1)
  │               ├─ tryAcquire：再次尝试（可能重入）
  │               └─ 失败 → addWaiter 加入CLH队列 → acquireQueued 阻塞
  └─ 公平锁跳过CAS抢锁，直接acquire
```

> **CLH 队列** 是一个双向链表。每个 Node 持有 waitStatus（是否被取消、是否需要唤醒后继等）。

---

## 四、volatile 关键字

### 4.1 两大语义

```java
private volatile boolean flag = true;
```

1. **可见性**：一个线程修改 flag，其它线程立即可见（绕过 CPU 缓存，直接读写主存）
2. **禁止指令重排序**：读写 volatile 变量前后的指令不能被重排序

### 4.2 经典例子：DCL 单例

```java
public class Singleton {
    private static volatile Singleton instance;
    
    public static Singleton getInstance() {
        if (instance == null) {           // 第一次检查
            synchronized (Singleton.class) {
                if (instance == null) {     // 第二次检查
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

**为什么需要 volatile？** `instance = new Singleton()` 不是原子操作：

```
分配内存 → 初始化对象 → 赋值给引用
  ①           ②           ③
```

JIT 可能重排序为 ①→③→②，另一个线程读到非 null 但未初始化的对象。volatile 禁止这个重排序。

---

## 五、常见并发工具

### 5.1 CountDownLatch

```java
// 等待 N 个线程完成
CountDownLatch latch = new CountDownLatch(3);

for (int i = 0; i < 3; i++) {
    new Thread(() -> {
        // 工作...
        latch.countDown(); // 计数减1
    }).start();
}

latch.await(); // 主线程等待计数到0
```

### 5.2 Semaphore（信号量）

```java
Semaphore sem = new Semaphore(3); // 同时允许3个线程

sem.acquire();  // 获取许可，没有则阻塞
// 访问资源
sem.release();  // 释放许可
```

### 5.3 面试题：三个线程交替打印ABC

```java
private int state = 0;
private final Lock lock = new ReentrantLock();
private final Condition[] conditions = {
    lock.newCondition(),
    lock.newCondition(),
    lock.newCondition()
};

public void print(int id) {
    for (int i = 0; i < 10; i++) {
        lock.lock();
        try {
            while (state % 3 != id) {
                conditions[id].await();
            }
            System.out.print((char) ('A' + id));
            state++;
            conditions[(id + 1) % 3].signal();
        } finally {
            lock.unlock();
        }
    }
}
```

---

## 六、常见面试题汇总

| 题目 | 回答要点 |
|------|---------|
| 线程和进程的区别？ | 进程=资源分配最小单位，线程=CPU调度最小单位，共享堆空间 |
| sleep 和 wait 的区别？ | sleep不释放锁，wait释放锁；sleep需要catch InterruptedException，wait需在synchronized块内 |
| 死锁的条件？ | 互斥、持有并等待、不可剥夺、循环等待 |
| 怎么避免死锁？ | 按固定顺序加锁、使用 tryLock 超时、减少锁粒度 |
| ThreadLocal 了解吗？ | 每个线程维护自己的副本，用 Entry(WeakReference) 存储，注意内存泄漏 |
| 线程池参数？ | corePoolSize, maxPoolSize, keepAliveTime, workQueue, threadFactory, handler |

---

## 七、线程池

### 7.1 ThreadPoolExecutor 核心参数

```java
new ThreadPoolExecutor(
    corePoolSize,       // 核心线程数
    maximumPoolSize,    // 最大线程数
    keepAliveTime,      // 空闲线程存活时间
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(100),  // 阻塞队列
    Executors.defaultThreadFactory(),
    new ThreadPoolExecutor.AbortPolicy()  // 拒绝策略
);
```

**执行流程：**

```
提交任务
  ├─ 线程数 < corePoolSize → 创建新线程执行
  ├─ 线程数 >= corePoolSize → 放入阻塞队列
  ├─ 队列满 → 线程数 < maxPoolSize → 创建临时线程
  └─ 队列满 & 线程数 >= maxPoolSize → 执行拒绝策略
```

### 7.2 拒绝策略

| 策略 | 行为 |
|------|------|
| AbortPolicy（默认） | 抛 RejectedExecutionException |
| CallerRunsPolicy | 提交任务的线程自己执行 |
| DiscardPolicy | 直接丢弃 |
| DiscardOldestPolicy | 丢弃队列中最旧的任务 |

---

## 总结

并发编程的核心脉络：

1. **线程**：创建、状态、中断
2. **共享**：synchronized、volatile、Lock
3. **协作**：wait/notify、Condition、LockSupport
4. **工具**：CountDownLatch、Semaphore、CyclicBarrier
5. **容器**：ConcurrentHashMap、CopyOnWriteArrayList
6. **线程池**：ThreadPoolExecutor、参数调优

面试实习岗位，掌握前三个就足以应对大多数问题了。建议结合源码（AQS 加锁流程、synchronized 锁升级）深入理解而不是死记硬背。
