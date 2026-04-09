const { app, Notification } = require('electron')
app.whenReady().then(() => {
  console.log('Notification:', typeof Notification)
  if (Notification) {
    console.log('Notification properties:', Object.keys(Notification))
    const instance = new Notification({ title: 'x' })
    console.log('Notification instance properties:', Object.keys(instance))
  }
  app.quit()
})
