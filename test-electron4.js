const { app, BrowserWindow } = require('electron')
const fs = require('fs')
fs.writeFileSync(
  'test.html',
  '<html><body><script>const {ipcRenderer} = require("electron"); require("electron").ipcRenderer.send("done", Notification.permission);</script></body></html>'
)
app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  win.loadFile('test.html')
  require('electron').ipcMain.on('done', (e, perm) => {
    console.log('Renderer Notification.permission:', perm)
    app.quit()
  })
})
