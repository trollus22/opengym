/* Settings App (runs in the Zepp app on the phone) — where server URL / username / password are
 * typed once, since a phone keyboard beats the watch's touchscreen for that. Saving hands the
 * three values to app-side/index.js via settingsStorage, which does the actual sign-in — see
 * docs/WATCH_APP.md.
 *
 * Known limitation: the TextInput component here has no password-masking mode, so the password
 * is visible while typing. It is never stored in the clear past the one sign-in attempt that
 * consumes it (app-side clears the key right away) — see app-side/index.js.
 */
AppSettingsPage({
  state: { server: '', username: '', password: '', status: '' },

  getStorage(props) {
    this.state.server = props.settingsStorage.getItem('server') || ''
    this.state.username = props.settingsStorage.getItem('username') || ''
    this.state.status = props.settingsStorage.getItem('status') || ''
  },

  build(props) {
    this.getStorage(props)
    const connected = this.state.status === 'connected'
    const errorMsg = this.state.status.indexOf('error:') === 0 ? this.state.status.slice(6) : ''

    return View({ style: { padding: '12px 16px' } }, [
      View({ style: { fontSize: '1.3rem', fontWeight: 'bold', marginBottom: '4px' } }, ['openGym']),
      View(
        {
          style: {
            fontSize: '0.9rem',
            marginBottom: '12px',
            color: connected ? '#2dbe5f' : errorMsg ? '#e5484d' : '#888'
          }
        },
        [connected ? `Connected as ${this.state.username}` : errorMsg || 'Not connected']
      ),
      Section({}, [
        TextInput({
          label: 'Server URL',
          placeholder: 'https://gym.example.com',
          value: this.state.server,
          onChange: v => { this.state.server = v }
        }),
        TextInput({
          label: 'Username',
          value: this.state.username,
          onChange: v => { this.state.username = v }
        }),
        TextInput({
          label: 'Password',
          placeholder: 'Re-enter to (re)connect',
          onChange: v => { this.state.password = v }
        })
      ]),
      View({ style: { marginTop: '12px' } }, [
        Button({
          label: connected ? 'Reconnect' : 'Connect',
          color: 'primary',
          onClick: () => {
            props.settingsStorage.setItem('server', this.state.server.trim())
            props.settingsStorage.setItem('username', this.state.username.trim())
            // Triggers app-side's onSettingsChange, which signs in and clears this key again —
            // see app-side/index.js.
            props.settingsStorage.setItem('password', this.state.password)
          }
        })
      ])
    ])
  }
})
