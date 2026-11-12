import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('luxvmEnv', {
  platform: process.platform,
  version: '1.0.0',
})
