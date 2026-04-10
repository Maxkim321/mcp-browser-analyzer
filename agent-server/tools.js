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
]

module.exports = { tools }
