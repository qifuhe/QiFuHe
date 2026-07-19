---
title: "Redis 核心知识与实战"
description: "缓存之王：数据结构、持久化、分布式锁与面试高频考点"
date: 2026-07-19
slug: "redis"
tags: ["Redis", "缓存", "NoSQL"]
categories: ["数据库"]
---

## 前言

Redis 是面试中出场率最高的中间件之一。它定位为 **内存数据库**，核心场景是缓存、分布式锁、计数器、消息队列等。

> 核心特点：**纯内存** + **单线程模型（6.x之前）** + **IO多路复用** = 10万+ QPS。

---

## 一、五大数据结构

### 1.1 概览

| 类型 | 示例 | 底层编码 | 使用场景 |
|------|------|---------|---------|
| String | `set key "value"` | int / embstr / raw | 缓存、计数器、分布式锁 |
| Hash | `hset user:1 name "alice"` | ziplist / hashtable | 对象存储 |
| List | `lpush list a b c` | quicklist | 消息队列、最新消息列表 |
| Set | `sadd set a b c` | intset / hashtable | 去重、共同好友 |
| ZSet | `zadd rank 100 "a"` | ziplist / skiplist | 排行榜、延迟队列 |

### 1.2 String 的内部编码

```c
// Redis 源码 object.c
if (len <= 20 && canEncodeAsInteger(value)) {
    // 用 int 编码（8字节）
} else if (len <= 44) {
    // 用 embstr 编码（一次分配内存，连续存储）
} else {
    // 用 raw 编码（两次分配）
}
```

> **面试题：String 最大能存多少？** 512 MB。

### 1.3 ZSet 底层 — 跳表（SkipList）

ZSet 用 **跳表 + 哈希表** 实现：
- 哈希表：存 member → score 映射（O(1) 查分）
- 跳表：存 score 排序（O(log N) 范围查询）

```
跳表结构：
Level 3: 1 ──────────────────────────→ 15
Level 2: 1 ───────→ 7 ──────────────→ 15
Level 1: 1 ─→ 3 ─→ 7 ─→ 9 ─→ 12 ─→ 15
Level 0: 1→2→3→4→7→8→9→10→12→14→15
```

每层是下层的一个子集，搜索时从最高层开始，空间换时间。

> **为什么用跳表而不是红黑树？** 跳表实现简单、区间遍历方便（链表结构天然支持）、不需要 rebalance。

---

## 二、持久化

### 2.1 RDB（快照）

```bash
# redis.conf
save 900 1      # 900秒内至少1个key修改 → 触发bgsave
save 300 10     # 300秒内至少10个key修改
save 60 10000   # 60秒内至少10000个key修改

# 手动执行
> BGSAVE  # 后台 fork 子进程生成 dump.rdb
```

**流程：**
```
主进程 fork() → 子进程写临时RDB文件 → 替换旧RDB文件
           ↓
子进程通过写时复制（Copy-on-Write）共享内存页
```

**优点**：文件小，恢复快。**缺点**：可能丢数据（两次快照之间的数据）。

### 2.2 AOF（追加日志）

日志格式：

```
*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n
```

三种刷盘策略：

```bash
appendfsync always    # 每次写操作都fsync → 最安全最慢
appendfsync everysec  # 每秒fsync → 默认，最多丢1秒数据
appendfsync no        # 交给OS刷盘 → 可能丢30秒+数据
```

**AOF 重写**（AOF Rewrite）：

```
BGREWRITEAOF
  → 子进程遍历内存数据，生成新的AOF文件
  → 将多个历史操作合并为当前数据的最小命令集合
```

### 2.3 混合持久化（Redis 4.0+，推荐）

```bash
aof-use-rdb-preamble yes
```

AOF 文件开头是 RDB 格式（快速恢复），后面是 AOF 增量日志（减少丢失）。

---

## 三、高可用

### 3.1 主从复制

```
主节点  ←——— 从节点1
              ←——— 从节点2
```

同步流程：
1. 从节点发送 `PSYNC` 命令
2. 主节点执行 `BGSAVE` 生成 RDB 发给从节点
3. 同时将新写操作缓存在缓冲区（replication buffer）
4. 从节点加载 RDB → 主节点发送缓冲区增量数据

### 3.2 哨兵（Sentinel）

监控 + 自动故障转移：

```
Sentinel集群(3个节点，奇数)
    │ 监控
    ▼
主节点 ── 从节点1, 从节点2

主观下线 → 客观下线（多个Sentinel确认） → 选举新主节点
```

### 3.3 集群（Cluster）

数据分片（16384 个槽）：

```
CRC16(key) % 16384 → 确定由哪个节点处理
```

```
节点1: 0~5460
节点2: 5461~10922
节点3: 10923~16383
```

> 客户端直连任意节点，如果 key 不在该节点上，返回 MOVED 重定向。

---

## 四、缓存设计与常见问题

### 4.1 过期策略

```
惰性删除：访问 key 时检查是否过期，过期则删除
         + 
定期删除：每 100ms 随机抽查一批带有过期时间的 key，删除过期的
```

> 如果过期 key 太多没删完，内存满了怎么办？→ **内存淘汰策略**

### 4.2 内存淘汰策略

```bash
maxmemory-policy volatile-lru  # 默认
```

| 策略 | 说明 |
|------|------|
| noeviction | 内存满直接报错（默认，但很多系统改为别的）|
| allkeys-lru | 淘汰最近最少使用的 key |
| volatile-lru | 在设置了过期时间的 key 中 LRU |
| allkeys-lfu | 淘汰使用频率最低的 key（4.0+）|
| volatile-ttl | 淘汰即将过期的 key |

> **LRU 近似算法**：Redis 不维护精确的访问时间，而是采样 5 个 key（可配置）淘汰最旧的。

### 4.3 缓存三大问题

**缓存穿透**：查一个不存在的数据（缓存和 DB 都没有）
```
解法：布隆过滤器（Bloom Filter）"一定不存在的 key 直接拒绝"
      或缓存空值（短期），但注意不要被恶意 key 打满
```

**缓存击穿**：热点 key 失效，大量请求打到 DB
```
解法：互斥锁（SETNX），只让一个线程去查 DB，其它等待
      或者设置热点 key "永不过期" + 后台线程主动刷新
```

**缓存雪崩**：大量 key 同时过期 / Redis 宕机
```
解法：过期时间加随机值（基础时间 ± 随机值）
      构建高可用（主从+哨兵/集群）
      本地缓存做二级缓存
```

### 4.4 缓存一致性（最棘手的题）

```java
// 常见的"先更新DB，再删缓存"模式（Cache-Aside）
public void updateUser(User user) {
    db.update(user);           // 1. 先更新数据库
    cache.del(user.getId());   // 2. 再删除缓存（不是更新缓存）
}
// 为什么要删而不是更新？避免并发写导致缓存里写旧值
```

**不一致的情况**：
```
线程A: 更新DB → ❌系统挂了，没删缓存
线程B: 读缓存（旧数据）
```

**保证最终一致**：
- 延时双删：先删缓存→更新 DB→延时再删缓存
- 订阅 binlog（Canal）+ 删除或者更新缓存
- 高一致性场景：用分布式锁或直接读 DB

> 面试中不要只说一种方案，要说明**一致性要求越高，性能越低**，根据业务选择。

---

## 五、分布式锁

```java
// 用 Redisson 实现（推荐，自带了看门狗 Watchdog）
RLock lock = redissonClient.getLock("myLock");
lock.lock(10, TimeUnit.SECONDS);
try {
    // 业务逻辑
} finally {
    lock.unlock();
}
```

**Redis 分布式锁要点**：
1. SET NX EX（加锁+过期，原子操作）
2. 删除锁时用 Lua 脚本校验 value（防止删别人的锁）
3. Redisson Watchdog 自动续期（避免业务没执行完锁过期）
4. RedLock 算法（多节点+大多数同意才算拿到）— 仅在极端安全场景需要

---

## 面试重点速记

| 题目 | 要点 |
|------|------|
| Redis 为什么快？ | 纯内存 + 单线程（避免上下文切换） + IO多路复用 |
| String 底层？ | int/embstr/raw，小于44字节用 embstr |
| ZSet 底层？ | 跳表 + 哈希表，O(logN) |
| 持久化怎么选？ | RDB恢复快但丢数据，AOF安全但文件大，混合最好 |
| 过期策略？ | 惰性删除 + 定期删除 |
| 淘汰策略？ | allkeys-lru 最常用 |
| 缓存穿透/击穿/雪崩？ | 布隆过滤器 / 互斥锁 / 随机过期时间 |
| 分布式锁怎么实现？ | SET NX EX + Lua 校验 + Redisson Watchdog |
