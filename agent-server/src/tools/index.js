/**
 * MCP 工具定义
 * 定义所有可用的 MCP 工具及其输入参数 schema
 */

const tools = [
  {
    name: 'list_connections',
    description: '列出当前所有连接的浏览器插件实例',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'navigate_to',
    description: '导航到指定URL，用于测试首屏加载性能',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要导航到的URL，例如 https://example.com',
        },
        connectionId: {
          type: 'number',
          description: '浏览器插件连接ID，可选；缺省时默认使用当前会话连接',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'reload_page',
    description: '刷新当前页面，用于重新测试性能',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'number',
          description: '浏览器插件连接ID，可选；缺省时默认使用当前会话连接',
        },
        ignoreCache: {
          type: 'boolean',
          description: '是否忽略缓存强制刷新，默认为false',
        },
      },
    },
  },
  {
    name: 'wait_for_load',
    description: '等待页面加载完成',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'number',
          description: '浏览器插件连接ID，可选；缺省时默认使用当前会话连接',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认为30000',
        },
      },
    },
  },
  {
    name: 'get_browser_performance',
    description: '获取指定浏览器标签页的性能数据',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'number',
          description: '浏览器插件连接ID，可选；缺省时默认使用当前会话连接',
        },
      },
    },
  },
  {
    name: 'broadcast_message',
    description: '向所有连接的浏览器插件广播消息',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '要广播的消息内容',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'todo_write',
    description: '创建或更新任务列表，用于管理多步骤操作。使用这个工具来规划和跟踪你的工作进度。',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: '任务列表，每个任务包含 id、content、status、priority',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '任务唯一标识符',
              },
              content: {
                type: 'string',
                description: '任务描述',
              },
              status: {
                type: 'string',
                description: '任务状态：pending（待处理）、in_progress（进行中）、completed（已完成）',
                enum: ['pending', 'in_progress', 'completed'],
              },
              priority: {
                type: 'string',
                description: '任务优先级：high（高）、medium（中）、low（低）',
                enum: ['high', 'medium', 'low'],
              },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
  },
]

module.exports = { tools }
