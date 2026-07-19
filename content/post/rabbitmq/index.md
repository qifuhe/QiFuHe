---
title: "RabbitMQ 消息队列核心原理"
description: "消息中间件基础：交换机、队列、可靠投递与死信队列"
date: 2026-07-19
slug: "rabbitmq"
tags: ["RabbitMQ", "消息队列", "中间件"]
categories: ["中间件"]
---

## 前言

RabbitMQ 是基于 AMQP 协议的开源消息中间件，用 Erlang 编写。核心模型是 **生产者 → 交换机 → 队列 → 消费者**。

> 面试重点：**五种消息模型**、**可靠投递**、**死信队列**、**如何避免消息堆积**。

---

## 一、核心概念

### 1.1 架构

```
           ┌────────────── Virtual Host ──────────────┐
           │                                          │
Producer ──→ Exchange（交换机）──binding──→ Queue ←── Consumer
           │                     routing key           │
           │                    ┌──────────────┐      │
           │                    │   绑定关系     │      │
           │                    │ queueA → rk1  │      │
           │                    │ queueB → rk2  │      │
           │                    └──────────────┘      │
           └──────────────────────────────────────────┘
```

| 组件 | 作用 |
|------|------|
| Producer | 消息的发送者 |
| Exchange | 路由器，根据 routing key 将消息发给一个或多个队列 |
| Queue | 消息的缓冲区，消费者从中取消息 |
| Consumer | 消息的接收处理者 |
| Virtual Host | 逻辑隔离，一个 Broker 可以划分多个 VHost |

### 1.2 四种交换机类型

```java
// 1. Direct Exchange（直连）
// 路由键精确匹配 → 点对点
channel.basicPublish("directExchange", "error", null, msg.getBytes());
// queue绑定 "error" → 只有这个queue能收到

// 2. Fanout Exchange（广播）
// 忽略 routing key，发给所有绑定的队列
channel.basicPublish("fanoutExchange", "", null, msg.getBytes());

// 3. Topic Exchange（主题，最灵活）
// 通配符匹配：* 匹配一个词，# 匹配零个或多个词
channel.basicPublish("topicExchange", "order.created", null, msg.getBytes());
// 可以绑定：order.*  → 收到 order.created、order.paid
//          order.#  → 收到 order.created、order.created.success

// 4. Headers Exchange（不常用）
// 用 header 属性匹配，不用 routing key
```

### 1.3 面试题：RabbitMQ 消息模型选型

| 场景 | 推荐模型 |
|------|---------|
| 一个订单消息发给一个处理服务 | Direct + Work Queue |
| 事件通知（用户注册→发邮件+发短信+更新积分） | Fanout |
| 根据类型路由（订单日志→不同队列处理） | Topic |

---

## 二、消息可靠投递

### 2.1 生产者 → RabbitMQ（确认机制）

```java
// Spring Boot 配置
spring.rabbitmq.publisher-confirm-type=correlated  // 开启确认
spring.rabbitmq.publisher-returns=true              // 开启回退

// 回调
@Bean
public RabbitTemplate.ConfirmCallback confirmCallback() {
    return (correlationData, ack, cause) -> {
        if (ack) {
            // 消息已到达交换器
        } else {
            // 消息未到达交换器 → 处理失败（记录日志/重试）
            log.error("消息发送失败: {}", cause);
        }
    };
}

@Bean
public RabbitTemplate.ReturnsCallback returnsCallback() {
    return returned -> {
        // 消息到达交换器但无匹配队列
        log.warn("消息路由失败: {}", returned.getMessage());
    };
}
```

### 2.2 RabbitMQ → 消费者（ACK）

```java
// 手动确认模式（推荐！）
spring.rabbitmq.listener.simple.acknowledge-mode=manual

@RabbitListener(queues = "order.queue")
public void handle(Order order, Message message, Channel channel) {
    try {
        // 处理业务
        process(order);
        // 处理完成，确认消息
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
    } catch (Exception e) {
        // 处理失败
        channel.basicNack(message.getMessageProperties().getDeliveryTag(), 
                         false, true);  // true=重新入队
    }
}
```

**三种 ACK 状态**：
```
basicAck    → 成功处理，删除消息
basicNack requeue=true  → 处理失败，重新入队
basicNack requeue=false → 处理失败，丢弃或进入死信队列（推荐用这个）
```

### 2.3 幂等性

```java
// 消息可能被重复消费 → 必须幂等
@RabbitListener(queues = "order.queue")
public void handle(Order order) {
    // 方案1：数据库唯一键约束
    String msgId = order.getMsgId();
    if (duplicateCheck.exists(msgId)) {
        return; // 已处理过
    }
    
    // 方案2：Redis SET NX
    Boolean ok = redisTemplate.opsForValue()
        .setIfAbsent("msg:" + msgId, "1", Duration.ofHours(1));
    if (Boolean.FALSE.equals(ok)) {
        return;
    }
    
    process(order);
}
```

---

## 三、死信队列（DLQ）

### 3.1 什么情况会变死信？

```
1. 消息被 consumer 拒绝（basicNack/basicReject）且 requeue=false
2. 消息 TTL 过期
3. 队列达到最大长度（溢出）
              ↓
      进入死信交换机（DLX）
              ↓
      死信队列（DLQ）
```

### 3.2 配置

```java
// 普通队列（指定死信交换机）
@Bean
public Queue orderQueue() {
    return QueueBuilder.durable("order.queue")
        .deadLetterExchange("order.dlx")       // 绑定死信交换机
        .deadLetterRoutingKey("order.dead")     // 死信的路由键
        .ttl(60000)                              // 消息过期时间
        .maxLength(10000)                        // 最大长度
        .build();
}

// 死信队列
@Bean
public Queue deadQueue() {
    return QueueBuilder.durable("order.dlq").build();
}

@Bean
public Binding deadBinding() {
    return BindingBuilder.bind(deadQueue())
        .to(new DirectExchange("order.dlx"))
        .with("order.dead");
}
```

**死信队列的价值：** 把处理失败的消息先存起来，便于重试和排查，不会阻塞主流程。

---

## 四、消息可靠投递总结

```
生产者 → Exchange → Queue → Consumer
   │          │        │        │
   └─confirm  └─return │        └─ack（手动确认）
                       │
                 队列持久化 + 消息持久化
                 durable=true, deliveryMode=PERSISTENT
```

**最可靠的模式**：
1. Publisher Confirm（确认消息到了交换器）
2. Mandatory + ReturnCallback（确保路由到队列）
3. 队列和消息持久化（重启不丢失）
4. 手动 ACK（不丢失消息）
5. 死信队列兜底（处理不了的消息不会丢）

---

## 五、Spring Boot 集成

### 5.1 配置

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    virtual-host: /
    publisher-confirm-type: correlated
    publisher-returns: true
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 1  # 每次只消费一条，处理完再拿下一条
        retry:
          enabled: true
          max-attempts: 3
          initial-interval: 2000
```

### 5.2 完整生产消费示例

```java
// 配置类
@Configuration
public class RabbitConfig {
    @Bean
    public DirectExchange orderExchange() {
        return new DirectExchange("order.exchange", true, false);
    }
    
    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable("order.queue")
            .deadLetterExchange("order.dlx")
            .build();
    }
    
    @Bean
    public Binding binding() {
        return BindingBuilder.bind(orderQueue())
            .to(orderExchange()).with("order");
    }
}

// 生产者
@Service
public class OrderProducer {
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    public void send(Order order) {
        CorrelationData cd = new CorrelationData(UUID.randomUUID().toString());
        rabbitTemplate.convertAndSend("order.exchange", "order", order, cd);
    }
}

// 消费者
@Component
public class OrderConsumer {
    @RabbitListener(queues = "order.queue")
    public void handle(Order order, Message msg, Channel channel) throws IOException {
        try {
            process(order);
            channel.basicAck(msg.getMessageProperties().getDeliveryTag(), false);
        } catch (Exception e) {
            channel.basicNack(msg.getMessageProperties().getDeliveryTag(), false, false);
        }
    }
}
```

---

## 六、常见问题

### 6.1 消息堆积

| 原因 | 解法 |
|------|------|
| 消费者处理太慢 | 增加消费者数量(`concurrency`)，或优化处理逻辑 |
| 消息突增 | 临时增加消费者，或队列设置最大长度防 OOM |
| 消费者挂了 | 报警 + 自动恢复 + 死信队列兜底 |

**RabbitMQ 本身存消息是磁盘，堆积太多会大量占用磁盘，严重影响性能。**

### 6.2 延迟队列

RabbitMQ 没有原生的延迟队列，通过 **TTL + 死信队列** 实现：

```
消息设置 TTL=10秒 → 进入 延时队列 → TTL 过期 → 死信队列 → 消费者
```

或者用 **rabbitmq-delayed-message-exchange** 插件：

```java
rabbitTemplate.convertAndSend("delayed.exchange", "routingKey", message,
    msg -> {
        msg.getMessageProperties().setDelay(10000); // 延迟10秒
        return msg;
    });
```

---

## 面试重点速记

| 题目 | 要点 |
|------|------|
| RabbitMQ 四种交换机？ | Direct / Fanout / Topic / Headers |
| 怎么保证消息不丢？ | Publisher Confirm + 持久化 + 手动 ACK + DLQ |
| 消息重复处理？ | 消费端幂等（唯一约束 / Redis 判重）|
| 死信队列作用？ | 存处理失败/过期的消息，便于排查和重试 |
| 消息堆积怎么处理？ | 增加消费者、优化消费逻辑、增加队列容量 |
| 延迟队列怎么实现？ | TTL + DLQ 方案 / delayed-message 插件 |
