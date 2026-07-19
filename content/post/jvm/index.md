---
title: "JVM 核心知识：内存模型、GC 与类加载"
description: "从 Java 虚拟机底层理解你的代码是怎么跑起来的"
date: 2026-07-19
slug: "jvm"
tags: ["Java", "JVM", "GC", "类加载"]
categories: ["Java"]
---

## 前言

JVM（Java Virtual Machine）是 Java "一次编写，到处运行" 的基石。实习生面试中 JVM 主要考察三个模块：**内存区域划分**、**垃圾回收**、**类加载机制**。

---

## 一、JVM 内存区域

### 1.1 整体结构

```
┌────────────────────────────────────┐
│           Java 堆 (Heap)           │ ← 所有线程共享
│    ┌──────────┬──────────┐        │
│    │  新生代   │  老年代   │        │
│    │ Eden S0 S1│          │        │
│    └──────────┴──────────┘        │
├────────────────────────────────────┤
│           方法区 (元空间)            │ ← 类信息、常量、静态变量
├────────────┬───────────────────────┤
│  虚拟机栈   │    本地方法栈           │ ← 线程私有
│ (栈帧)     │    (native)           │
├────────────┴───────────────────────┤
│          程序计数器 (PC)             │ ← 线程私有
└────────────────────────────────────┘
```

### 1.2 各区域详解

**堆（Heap）** — GC 主要活动区域
- 存储对象实例和数组
- 所有线程共享
- 分代管理：新生代（Eden + Survivor）× 老年代
- 默认比例：`-Xms` 初始堆，`-Xmx` 最大堆

**虚拟机栈（Stack）** — 线程私有
- 每个方法调用创建一个**栈帧**，包含：
  - 局部变量表（基本类型、对象引用）
  - 操作数栈（计算临时数据）
  - 动态链接（指向运行时常量池的方法引用）
  - 方法出口（return 地址）

```java
public int add(int a, int b) {
    return a + b;
}
// 字节码视角：
// 0: iload_1     ← 从局部变量表加载 a
// 1: iload_2     ← 从局部变量表加载 b
// 2: iadd        ← 操作数栈弹出a、b，相加，压回
// 3: ireturn     ← 返回结果
```

**方法区 / 元空间（Metaspace）**
- JDK 8+ 将永久代（PermGen）替换为元空间
- 元空间使用本地内存，不再受 JVM 堆大小限制
- 存储：类信息、常量、静态变量、JIT 编译后的代码

### 1.3 面试题：String 到底存在哪？

```java
String s1 = "hello";          // 字符串常量池（在堆中）
String s2 = new String("hello"); // 堆对象
String s3 = s2.intern();      // 返回常量池中的引用

System.out.println(s1 == s2); // false
System.out.println(s1 == s3); // true
```

> JDK 7 之后字符串常量池从方法区移到了堆中，但"进入常量池"的逻辑不变。

---

## 二、垃圾回收（GC）

### 2.1 判断对象是否存活

**引用计数法**（主流 JVM 不用）：
- 每个对象维护引用计数，为 0 即死亡
- 问题：循环引用无法回收

**可达性分析（JVM 实际使用）**：
- 从 GC Roots 出发，不可达的对象就是垃圾

```
GC Roots 包括：
├─ 虚拟机栈（局部变量表）中引用的对象
├─ 方法区中静态属性引用的对象
├─ 方法区中常量引用的对象
├─ 本地方法栈中 JNI 引用的对象
└─ 活跃线程（Thread）
```

### 2.2 引用类型

| 类型 | 说明 | GC 回收时机 |
|------|------|------------|
| 强引用 | `new Object()` | 永不回收 |
| 软引用 | SoftReference | 内存不足时 |
| 弱引用 | WeakReference | 下次GC必然回收 |
| 虚引用 | PhantomReference | 任何时候可能回收，用于跟踪对象回收 |

**ThreadLocal 内存泄漏**：`ThreadLocalMap` 的 key 是弱引用，value 是强引用。如果 key 被 GC 回收，value 永远无法访问，造成泄漏。

### 2.3 分代收集理论

```
新生代（1/3堆）           老年代（2/3堆）
┌─────────┬──┬──┐       ┌─────────┐
│  Eden   │S0│S1│  →    │   Old   │
│  8/10   │1/10│1/10│   │         │
└─────────┴──┴──┘       └─────────┘
     │
  Minor GC 触发：
  存活对象 age++ 并移到 S1（或老年代）
  Eden + S0 清空，S0/S1 交换角色
```

**对象晋升老年代的条件：**
1. 年龄达到阈值（默认15，通过 `-XX:MaxTenuringThreshold` 设置）
2. 大对象直接进入老年代（`-XX:PretenureSizeThreshold`）
3. Survivor 区同年龄对象总和 > Survivor 一半

### 2.4 常见 GC 算法

| 算法 | 描述 | 适用区域 |
|------|------|---------|
| 标记-清除 | 标记存活→清除死亡对象 | 老年代（CMS）|
| 标记-复制 | 分成两块，存活复制到另一块 | 新生代 |
| 标记-整理 | 标记存活→向一端移动→清理边界外 | 老年代（G1）|

### 2.5 常见垃圾收集器

```
Serial（单线程、暂停所有用户线程）
  │
Parallel Scavenge + Parallel Old（关注吞吐量）
  │
CMS（并发标记清除，关注最短停顿，有碎片问题）
  │
G1（区域化分代，默认 JDK 9+，大堆推荐）
  │
ZGC（JDK 17+ 生产可用，亚毫秒级停顿，适合超大堆）
```

**G1 关键特点**：
- 把堆分成多个 Region（1MB~32MB）
- 优先回收垃圾最多的 Region（Garbage First 名字来源）
- 通过 -XX:MaxGCPauseMillis 控制 GC 停顿时间
- 不需要连续内存，减少碎片

### 2.6 面试题：GC 什么时候触发？

```
Minor GC: Eden 区满时
Full GC:
  ├─ 老年代空间不足
  ├─ 元空间不足（JDK 8+）
  ├─ System.gc() 显式调用（只是建议，不保证）
  └─ promotion failed / concurrent mode failure（CMS）
```

---

## 三、类加载机制

### 3.1 类加载过程

```
加载 → 验证 → 准备 → 解析 → 初始化 → 使用 → 卸载
  │      │      │      │
  │      │      └── 分配静态变量内存+默认值
  │      └───────── 校验字节码合法性（CAFEBABE）
  └───────────── 读 class 文件二进制流
```

**初始化阶段**才执行 `<clinit>()` 方法（静态变量赋值 + 静态代码块）。

### 3.2 双亲委派模型

```java
// 简化版 ClassLoader.loadClass()
protected Class<?> loadClass(String name) {
    // 1. 检查是否已加载
    Class<?> c = findLoadedClass(name);
    if (c == null) {
        try {
            // 2. 交给父类加载器
            c = parent.loadClass(name);
        } catch (ClassNotFoundException e) {
            // 3. 父类找不到，自己找
            c = findClass(name);
        }
    }
    return c;
}
```

```
启动类加载器（Bootstrap ClassLoader）
  ↑ 委托
扩展类加载器（Extension ClassLoader）
  ↑ 委托
应用程序类加载器（Application ClassLoader）
  ↑ 委托
自定义类加载器
```

**为什么双亲委派？** 安全。防止自己写一个 `java.lang.String` 替换 JDK 的核心类。

### 3.3 打破双亲委派

Tomcat 等 Web 容器为了隔离多个应用的类，自己先加载，找不到才给父类。这也是 SPI（Service Provider Interface）机制的实现方式——`Thread.contextClassLoader`。

---

## 四、JVM 调优基础

### 4.1 常用参数

```bash
# 堆设置
-Xms512m          # 初始堆大小
-Xmx2g            # 最大堆大小
-Xmn256m          # 新生代大小
-XX:MetaspaceSize=128m  # 元空间大小
-XX:+UseG1GC      # 使用G1收集器
-XX:MaxGCPauseMillis=200  # 目标GC停顿时间

# 问题排查
-XX:+PrintGCDetails -XX:+PrintGCDateStamps
-Xloggc:gc.log
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/path/to/dump
```

### 4.2 OOM 排查思路

```
1. 确认错误信息：java.lang.OutOfMemoryError: Java heap space
               还是 java.lang.OutOfMemoryError: Metaspace
               或者是 java.lang.OutOfMemoryError: unable to create new native thread

2. 获取 dump：加上 -XX:+HeapDumpOnOutOfMemoryError

3. 分析 dump：用 jvisualvm / MAT / jprofiler
   - 看大对象（byte[] 通常是文件/图片）
   - 看类数量（加载了太多类→元空间问题）
   - 看线程数（太多线程→native thread OOM）
```

---

## 五、JIT 即时编译

热点代码被 JVM 编译为本地机器码，而不是一直解释执行。

```
解释执行（启动快，执行慢）
    │ 计数达到阈值
    ↓
C1 编译器（Client 模式，轻度优化）
    │ 更热的代码
    ↓
C2 编译器（Server 模式，深度优化）
```

分层编译（tiered compilation）结合了两者优点：先用 C1 快速编译，热点再升级到 C2。

> JDK 8 默认开启分层编译。

---

## 面试重点速记

| 题目 | 要点 |
|------|------|
| JVM 内存区域有哪些？ | 堆、栈、方法区、程序计数器、本地方法栈，各司其职 |
| new 对象的过程？ | 类加载检查→分配内存（指针碰撞/空闲列表）→初始化零值→设置对象头→执行 init |
| 有哪些 GC 算法？ | 标记-清除、标记-复制、标记-整理 |
| CMS 和 G1 区别？ | CMS 并发但碎片化，G1 分区整理、可预测停顿 |
| 双亲委派机制？ | 向上委托，向下加载，安全+避免重复 |
| OOM 怎么排查？ | 参数留痕→拿到 dump→找大对象/线程/类加载器 |
