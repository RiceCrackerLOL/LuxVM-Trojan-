import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in Main Process:', error)
  dialog.showErrorBox('Critical Error', `An unexpected error occurred:\n\n${error.message}`)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason)
})

let mainWindow: BrowserWindow | null = null

function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL).catch((err) => {
        console.error('Failed to load Vite dev server URL:', err)
      })
    } else {
      const indexPath = path.join(__dirname, '../dist/index.html')
      mainWindow.loadFile(indexPath).catch((err) => {
        console.error('Failed to load production index.html:', indexPath, err)
        dialog.showErrorBox('Startup Error', `Could not load application interface from:\n${indexPath}`)
      })
    }

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  } catch (err) {
    console.error('Failed to create browser window:', err)
    dialog.showErrorBox('Window Creation Error', String(err))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((err) => {
  console.error('App initialization failed:', err)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
