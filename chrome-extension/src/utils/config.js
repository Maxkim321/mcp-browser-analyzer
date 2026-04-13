import { resolve } from 'node:path'
import process from 'node:process'

const root = process.cwd()
export const r = (...args) => resolve(root, ...args)
export const isDev = process.env.NODE_ENV === 'development'
export const port = Number(process.env.PORT || '') || 3000

// 大模型配置
export const modelApiKey = process.env.MODEL_API_KEY
export const modelApiBaseUrl = process.env.MODEL_API_BASE_URL
export const modelName = process.env.MODEL_NAME
