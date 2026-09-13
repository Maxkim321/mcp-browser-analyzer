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
    name: 'run_lighthouse_audit',
    description:
      '对指定 URL 运行完整的 Lighthouse 性能审计（服务端 headless Chrome，不需要浏览器插件在线，不占用用户当前页面）。' +
      '返回 Performance/Accessibility/Best-Practices/SEO 四类得分、核心指标（FCP/LCP/TBT/CLS/SI）、' +
      '按可节省时间排序的优化机会和低分审计项。一次全分类审计通常需要 30-60 秒。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要审计的页面 URL，例如 https://example.com',
        },
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['performance', 'accessibility', 'best-practices', 'seo'],
          },
          description: '要审计的分类，默认全部四类。只关心性能时可只传 ["performance"] 以加快速度',
        },
      },
      required: ['url'],
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
    name: 'get_page_content',
    description:
      '获取当前激活标签页的正文内容（去除导航/广告，基于 Readability 提取），用于总结、问答或内容分析。返回 {url, title, content, charCount}',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'number',
          description: '浏览器插件连接ID，可选；缺省时默认使用当前会话连接',
        },
        maxChars: {
          type: 'number',
          description: '返回内容的最大字符数，超出则截断，默认 12000',
        },
      },
    },
  },
  {
    name: 'fetch_url',
    description:
      '在后台新开标签页获取指定 URL 的正文内容（不打扰用户当前页面，读完自动关闭），用于深度研究多页阅读。返回 {url, title, content, charCount}',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要读取的页面 URL，例如 https://en.wikipedia.org/wiki/MCP',
        },
        maxChars: {
          type: 'number',
          description: '返回内容的最大字符数，超出则截断，默认 12000',
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
    name: 'web_search',
    description:
      '用浏览器搜索引擎检索关键词，返回真实存在的结果链接列表（不打扰用户当前页面，读完自动关闭）。深度研究必须先用它拿到真实 URL，再用 fetch_url 读正文。返回 {query, engine, results:[{title, url}]}',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，例如 2027 秋招 前端 岗位 竞争',
        },
        maxResults: {
          type: 'number',
          description: '返回结果条数上限，默认 5',
        },
        connectionId: {
          type: 'number',
          description: '浏览器插件连接ID，可选；缺省时默认使用当前会话连接',
        },
      },
      required: ['query'],
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
  // ===== 写操作工具（dangerLevel:'write'）：每次执行前必须经用户审批（分级权限 HITL）=====
  {
    name: 'get_interactive_elements',
    dangerLevel: 'read',
    description:
      '枚举当前页面的可交互元素（按钮/链接/输入框/下拉框）及其 CSS 选择器。' +
      '执行任何写操作（click_element/fill_input/select_option）之前必须先用它定位目标元素，' +
      '不要凭猜测构造选择器。返回 {url, elements:[{selector, tag, type, text, value}]}',
    inputSchema: {
      type: 'object',
      properties: {
        maxElements: {
          type: 'number',
          description: '最多返回的元素数量，默认 30',
        },
        connectionId: {
          type: 'number',
          description: '浏览器插件连接ID，可选；缺省时默认使用当前会话连接',
        },
      },
    },
  },
  {
    name: 'click_element',
    dangerLevel: 'write',
    description:
      '点击页面上的元素（按钮/链接等）。写操作：执行前会请求用户审批。' +
      'selector 必须来自 get_interactive_elements 返回的选择器，不要凭记忆构造。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: '目标元素的 CSS 选择器，例如 #submit-btn',
        },
        description: {
          type: 'string',
          description: '这个点击要做什么的一句话说明，会展示在审批卡片上，例如「提交订阅表单」',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'fill_input',
    dangerLevel: 'write',
    description:
      '向页面的输入框/文本域填入文字。写操作：执行前会请求用户审批，填入的值会展示在审批卡片上。' +
      'selector 必须来自 get_interactive_elements 返回的选择器。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: '目标输入框的 CSS 选择器，例如 #email',
        },
        value: {
          type: 'string',
          description: '要填入的文字',
        },
        description: {
          type: 'string',
          description: '这个填写要做什么的一句话说明，例如「填写邮箱地址」',
        },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'select_option',
    dangerLevel: 'write',
    description:
      '选中下拉框（select 元素）的某个选项。写操作：执行前会请求用户审批。' +
      'selector 必须来自 get_interactive_elements 返回的选择器；value 匹配 option 的 value 或文本。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: '目标下拉框的 CSS 选择器，例如 #frequency',
        },
        value: {
          type: 'string',
          description: '要选中的选项值（匹配 option 的 value 属性或可见文本）',
        },
        description: {
          type: 'string',
          description: '这个选择要做什么的一句话说明，例如「选择每周推送」',
        },
      },
      required: ['selector', 'value'],
    },
  },
]

/** 写工具元数据判定的唯一出口：pipeline 审批、审计留痕、eval 轨迹判卷共用同一口径 */
function isWriteTool(toolName) {
  const tool = tools.find((t) => t.name === toolName)
  return !!tool && tool.dangerLevel === 'write'
}

module.exports = { tools, isWriteTool }
