const { app, systemPreferences } = require('electron')
app.whenReady().then(() => {
  let obj = systemPreferences
  let keys = new Set()
  while (obj) {
    Object.getOwnPropertyNames(obj).forEach((k) => keys.add(k))
    obj = Object.getPrototypeOf(obj)
  }
  console.log(Array.from(keys).filter((k) => k.toLowerCase().includes('notif')))
  app.quit()
})
