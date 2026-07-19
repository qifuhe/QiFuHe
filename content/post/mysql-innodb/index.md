---
title: "MySQL 与 InnoDB：存储引擎核心原理"
description: "从一条 SQL 的执行到 InnoDB 的 MVCC、索引与锁机制"
date: 2026-07-19
slug: "mysql-innodb"
tags: ["MySQL", "InnoDB", "数据库", "索引"]
categories: ["数据库"]
---

## 前言

MySQL 是最流行的关系型数据库，而 **InnoDB** 是 MySQL 默认（且最常用）的存储引擎。实习生面试的重点：**索引、事务隔离、MVCC、锁机制**。

---

## 一、一条 SQL 的执行过程

```
客户端 → 连接器（认证+维持连接）
         → 查询缓存（8.0 已移除）
         → 解析器（词法分析 → 语法分析 → 生成 AST）
         → 预处理器（检查表/列是否存在）
         → 优化器（选择索引、决定 JOIN 顺序、生成执行计划）
         → 执行器（调用存储引擎接口，返回结果）
```

**关键点：**
- 连接器管理连接超时（`wait_timeout`，默认8小时）
- 优化器选错索引是慢查询的常见原因（可通过 `force index` 强制指定）
- 执行器真正调存储引擎的 `read` 接口，一行行返回

---

## 二、InnoDB 架构

### 2.1 内存结构

```
┌─ Buffer Pool（缓冲池）────────────────┐
│  ├─ 数据页缓存 (data pages)           │
│  ├─ 索引页缓存 (index pages)          │
│  ├─ 插入缓冲 (change buffer)          │
│  ├─ 自适应哈希索引 (Adaptive Hash Index)│
│  └─ 锁信息 (lock info)                │
└────────────────────────────────────────┘
      │
      │ 通过 redo log 保证持久性（WAL）
      ▼
┌─ 磁盘 ──────────────────────────────┐
│  .ibd 文件（表数据+索引）           │
│  redo log（ib_logfile0/1）          │
│  undo log（回滚段）                  │
│  binlog（Server 层，归档+主从）       │
└──────────────────────────────────────┘
```

**Buffer Pool** 是 InnoDB 的灵魂，用 **LRU 变体** 管理缓存页。`innodb_buffer_pool_size` 通常设为物理内存的 60%~80%。

### 2.2 WAL（Write-Ahead Logging）

"先写日志，再写磁盘。" 修改数据时：

```
更新内存中的 Buffer Pool (脏页)
     ↓
写入 redo log（顺序IO，很快） ← 做到这里就返回"修改成功"
     ↓
后台线程在合适时机将脏页刷回磁盘（随机IO，较慢）
```

**为什么 WAL 快？**
- redo log 是**顺序追加写**（磁盘顺序 IO ≈ 1000MB/s）
- 数据文件是**随机写**（磁盘随机 IO ≈ 10MB/s）
- 顺序写比随机写快两个数量级

---

## 三、索引

### 3.1 B+ Tree 结构

InnoDB 使用 **B+ Tree** 作为索引结构。

```
           ┌───────────┐
           │  非叶子节点  │ ← 只存"索引键 + 指向子节点的指针"
           │   [50, 80] │    一个页(16KB)能存几百~上千个key
           └─────┬─────┘
                 │
         ┌───────┼───────┐
         ▼       ▼       ▼
   ┌────┐  ┌────┐  ┌────┐
   │1-49│  │51-79│  │81-+│  ← 非叶子节点
   └────┘  └────┘  └────┘
         ...
           ┌───────────┐
           │  叶子节点   │ ← 存"完整的行数据"（聚簇索引）
           │           │   或"主键值"（二级索引）
           └───────────┘
       叶子节点用双向链表连接 → 支持范围查询
```

**B+ Tree 比 B-Tree 好在哪里？**
- 非叶子节点不存数据，一个页能存更多 key → 树更矮 → IO 更少
- 叶子节点链表连接，范围查询只需遍历链表

### 3.2 聚簇索引 vs 二级索引

```sql
CREATE TABLE user (
    id INT PRIMARY KEY,       -- 聚簇索引
    name VARCHAR(50),
    age INT,
    INDEX idx_name (name)     -- 二级索引
);
```

| | 聚簇索引 | 二级索引 |
|---|---|---|
| 谁建立的 | 主键 | 自己建立的索引 |
| 叶子节点存什么 | 完整行数据 | 主键值 |
| 数量 | 1个 | 多个 |
| 回表 | 不需要 | 查二级索引得到主键→回聚簇索引查完整行 |

**覆盖索引**：如果查询只需要 name，二级索引 `idx_name` 的叶子节点就包含了 name，不需要回表。

```sql
-- 只查 name，idx_name 已经包含 name，无需回表
SELECT name FROM user WHERE name = 'Alice';
```

### 3.3 索引最左前缀原则

```sql
CREATE INDEX idx_city_age ON user(city, age);
-- 走索引：WHERE city = '北京'
-- 走索引：WHERE city = '北京' AND age = 25
-- 不走索引：WHERE age = 25 （跳过了city）
```

> 联合索引本质是按第一列排序→再按第二列排序。跳过第一列直接查第二列就没意义了。

### 3.4 面试题：为什么用 B+ Tree 而不是红黑树 / 哈希？

| 结构 | 优点 | 缺点 |
|------|------|------|
| 哈希 | O(1) 精确查询 | 不支持范围查询、无法排序 |
| 红黑树 | 平衡二叉树 | 树太高，一个路径可能几十次 IO |
| B+ Tree | 胖矮（3~4层），范围查询高效 | 结构略复杂 |

**磁盘 IO 一次 ≈ 10ms，B+ Tree 3~4 层 = 3~4 次 IO，红黑树几十层 = 几十次 IO。**

---

## 四、事务与 MVCC

### 4.1 ACID

| 特性 | 含义 | InnoDB 实现 |
|------|------|-------------|
| A（原子性） | 要么全做，要么全不做 | undo log（回滚）|
| C（一致性） | 数据始终符合约束 | 应用+数据库共同保证 |
| I（隔离性） | 事务互不干扰 | 锁 + MVCC |
| D（持久性） | 提交后数据不丢失 | redo log + double write buffer |

### 4.2 隔离级别

```sql
-- MySQL 四种隔离级别（由低到高）
READ UNCOMMITTED    -- 脏读、不可重复读、幻读都可能
READ COMMITTED      -- 解决了脏读（Oracle默认）
REPEATABLE READ     -- 解决了脏读+不可重复读（InnoDB默认）
SERIALIZABLE        -- 全部解决，但性能最低
```

**InnoDB 默认是 REPEATABLE READ，但通过间隙锁解决了幻读。**

### 4.3 MVCC 多版本并发控制

MVCC 是 InnoDB 实现高并发的核心。

**核心数据结构**：每行数据有两个隐藏列：
- `DB_TRX_ID`：最近修改这行数据的事务 ID
- `DB_ROLL_PTR`：指向 undo log 的指针，用于构建旧版本

**ReadView（读视图）**：事务在某个时刻看到的数据版本快照。

```java
// ReadView 包含：
// m_ids     → 当前活跃的事务ID列表
// min_trx_id → m_ids 中的最小值
// max_trx_id → 下一个要分配的事务ID
// creator_trx_id → 创建这个 ReadView 的事务自己的ID
```

**判断是否可见的规则：**

```
DB_TRX_ID < min_trx_id  → 可见（已提交）
DB_TRX_ID > max_trx_id  → 不可见（未来的事务）
DB_TRX_ID in m_ids      → 不可见（活跃中）
creator_trx_id          → 自己改的，可见
```

> **RC（读已提交）级别：** 每次 SELECT 都生成一个新的 ReadView
> **RR（可重复读）级别：** 事务中第一次 SELECT 生成 ReadView，之后复用

### 4.4 MVCC + 幻读

RR 级别下，MVCC 只能保证 **快照读**（普通 SELECT）没有幻读。

```sql
-- 事务A
SELECT * FROM user WHERE age > 20;  -- 查到了5行，生成ReadView
                                      -- 这就是快照读，能看到的历史版本
-- 事务B插入一条 age=25 的数据并提交

-- 事务A 再次执行
SELECT * FROM user WHERE age > 20;  -- 还是5行（MVCC快照隔离了B的插入）

-- 但如果事务A执行
UPDATE user SET name = 'x' WHERE age > 20;  -- 当前读，能看到事务B插入的行
-- 这时就能看到新行 → 幻读出现在"当前读"而非"快照读"
```

为了防止 **当前读** 幻读，InnoDB 加 **间隙锁（Gap Lock）**。

---

## 五、锁机制

### 5.1 行锁

InnoDB 锁的是 **索引记录**（不是数据行本身！）：

```sql
-- 走主键/唯一索引 → 锁住对应行（Record Lock）
UPDATE user SET name = 'a' WHERE id = 1;

-- 走普通索引 → 锁住索引记录+间隙（Gap Lock / Next-Key Lock）
UPDATE user SET name = 'a' WHERE age = 25;

-- 没走索引 → 锁全表！（所有行）
UPDATE user SET name = 'a' WHERE name LIKE '%x%';
```

> **没有索引就会锁全表！** 这是 InnoDB 最常见的性能陷阱。

### 5.2 行锁算法

| 类型 | 范围 | 场景 |
|------|------|------|
| Record Lock | 锁单个索引记录 | 等值匹配唯一索引 |
| Gap Lock | 锁间隙（区间），不锁记录 | 等值匹配普通索引 / 范围查询 |
| Next-Key Lock | Gap + Row = 锁区间+记录 | 默认算法，防幻读 |

```
假设索引值：[5, 10, 15, 20]

WHERE age = 10 的 Next-Key Lock 锁 (5, 10] 和 (10, 15)
  ↓
另一个事务插入 age=8 或 age=12 会被阻塞（防止幻读）
插入 age=16 可以
```

### 5.3 死锁

```sql
-- 事务A
UPDATE user SET name = 'a' WHERE id = 1;
UPDATE user SET name = 'b' WHERE id = 2;

-- 事务B
UPDATE user SET name = 'c' WHERE id = 2;
UPDATE user SET name = 'd' WHERE id = 1;
```

**InnoDB 自动检测死锁**：会将一个事务回滚（选择的回滚成本较小的那个）。`SHOW ENGINE INNODB STATUS\G` 可以查看最近一次死锁信息。

**避免方案**：固定访问顺序（比如都按 id 从小到大操作）。

---

## 六、SQL 优化基础

### 6.1 EXPLAIN 怎么看

```sql
EXPLAIN SELECT * FROM user WHERE name = 'Alice'\G
```

关键字段：

| 字段 | 要关注的 |
|------|---------|
| type | const > ref > range > index > ALL（最好到最差）|
| key | 实际使用的索引 |
| rows | 预估扫描行数 |
| Extra | Using index（覆盖索引）、Using filesort（需要优化）、Using temporary（最差）|

### 6.2 常见优化方向

```
1. 避免 SELECT *  → 减少回表，利用覆盖索引
2. 避免索引列上做计算 → WHERE age+1 > 20 不走索引
3. 避免隐式类型转换 → WHERE phone = 138... 如果phone是varchar，不走索引
4. LIKE '%abc' 不走索引（最左前缀），'abc%' 可以走
5. 分页优化 → 用游标（WHERE id > ? LIMIT 10）代替 LIMIT 100000, 10
6. JOIN 小表驱动大表 → 被驱动表关联字段加索引
```

---

## 面试重点速记

| 题目 | 要点 |
|------|------|
| InnoDB 索引结构？ | B+ Tree，聚簇索引存完整行，二级索引存主键 |
| 为什么用 B+ Tree？ | 树矮（3~4层）= 少 IO，叶子链表=范围查询高效 |
| 什么是回表？ | 二级索引查到主键→再查聚簇索引取完整行 |
| MVCC 原理？ | 隐藏列(TRX_ID) + ReadView + undo log 构造快照 |
| 事务隔离级别？ | RU/RC(RR InnoDB默认)/SERIALIZABLE，InnoDB RR防了幻读 |
| 行锁、间隙锁、Next-Key？ | 锁索引，无索引锁全表，Next-Key = Record + Gap |
