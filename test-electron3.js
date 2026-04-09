const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  win.loadURL(
    'data:text/html,<html><body><script>const {ipcRenderer} = require("electron"); console.log("Perm:", Notification.permission); require("electron").ipcRenderer.send("done", Notification.permission);</script></body></html>'
  )
  require('electron').ipcMain.on('done', (e, perm) => {
    console.log('Renderer Notification.permission:', perm)
    app.quit()
  })
})
