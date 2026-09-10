import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const initialScheduled = [
  { id: '1', email: 'alex@rivetlabs.com', subject: 'A quick idea for Rivet Labs', scheduledAt: 'Today, 10:30 AM', status: 'Queued', initials: 'AR', color: 'teal' },
  { id: '2', email: 'maya@northstar.io', subject: 'Northstar x ReachInbox', scheduledAt: 'Today, 11:15 AM', status: 'Queued', initials: 'MN', color: 'orange' },
  { id: '3', email: 'chris@lumen.co', subject: 'Scaling Lumen outreach', scheduledAt: 'Tomorrow, 9:00 AM', status: 'Queued', initials: 'CL', color: 'blue' },
]

const initialSent = [
  { id: '4', email: 'jordan@atlas.dev', subject: 'A better way to find leads', scheduledAt: 'Sep 09, 2:42 PM', status: 'Delivered', initials: 'JA', color: 'purple' },
  { id: '5', email: 'sam@orbital.ai', subject: 'Orbital + ReachInbox', scheduledAt: 'Sep 09, 1:18 PM', status: 'Delivered', initials: 'SO', color: 'pink' },
  { id: '6', email: 'lee@foundry.com', subject: 'Foundry growth plans', scheduledAt: 'Sep 08, 4:06 PM', status: 'Failed', initials: 'LF', color: 'yellow' },
]

function Icon({ name }) {
  const paths = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.84 1.84-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20H11v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.84-1.84.06-.06A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.56-1.03H5V11h.04A1.7 1.7 0 0 0 6.6 10a1.7 1.7 0 0 0-.34-1.88L6.2 8.06 8.04 6.2l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11 5.04V5h2v.04a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.84 1.84-.06.06A1.7 1.7 0 0 0 17.4 10c.23.62.82 1.03 1.48 1.03H19V13h-.12c-.66 0-1.25.4-1.48 1Z',
    plus: 'M12 5v14M5 12h14',
    upload: 'M12 16V4m0 0L7 9m5-5 5 5M4 20h16',
    close: 'M18 6 6 18M6 6l12 12',
    search: 'm21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

function App() {
  const [activeTab, setActiveTab] = useState('Scheduled')
  const [showCompose, setShowCompose] = useState(false)
  const [scheduled, setScheduled] = useState(initialScheduled)
  const [sent, setSent] = useState(initialSent)
  const [fileName, setFileName] = useState('')
  const [leadCount, setLeadCount] = useState(0)
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const fileInput = useRef(null)
  const rows = activeTab === 'Scheduled' ? scheduled : sent
  const stats = useMemo(() => ({ scheduled: scheduled.length, sent: sent.length }), [scheduled.length, sent.length])

  useEffect(() => {
    Promise.all([fetch('http://localhost:3001/api/emails?status=scheduled'), fetch('http://localhost:3001/api/emails?status=sent')])
      .then(async ([scheduledResponse, sentResponse]) => {
        if (!scheduledResponse.ok || !sentResponse.ok) throw new Error('API unavailable')
        const [scheduledResult, sentResult] = await Promise.all([scheduledResponse.json(), sentResponse.json()])
        const formatRows = (items) => items.map((item, index) => ({ ...item, email: item.recipient, scheduledAt: new Date(item.scheduledAt).toLocaleString(), status: item.status === 'sent' ? 'Delivered' : item.status, initials: item.recipient.slice(0, 2).toUpperCase(), color: ['teal', 'orange', 'blue', 'purple'][index % 4] }))
        setScheduled(formatRows(scheduledResult.data))
        setSent(formatRows(sentResult.data))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function parseLeads(file) {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const emails = String(event.target.result).match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []
      const uniqueEmails = [...new Set(emails.map((email) => email.toLowerCase()))]
      setLeads(uniqueEmails)
      setLeadCount(uniqueEmails.length)
    }
    reader.readAsText(file)
  }

  async function scheduleEmail(event) {
    event.preventDefault()
    const payload = { subject: event.target.subject.value, body: event.target.body.value, recipients: leads, scheduledAt: new Date(event.target.scheduledAt.value).toISOString(), sender: 'demo@reachinbox.test' }
    try {
      const response = await fetch('http://localhost:3001/api/emails/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error('The scheduler is unavailable. Start Redis and the backend first.')
      const result = await response.json()
      setScheduled((items) => [...result.data.map((item) => ({ ...item, email: item.recipient, scheduledAt: new Date(item.scheduledAt).toLocaleString(), status: 'Queued', initials: item.recipient.slice(0, 2).toUpperCase(), color: 'teal' })), ...items])
    } catch (error) {
      setToast(error.message)
      window.setTimeout(() => setToast(''), 4200)
      return
    }
    setShowCompose(false)
    setToast('Campaign scheduled successfully')
    window.setTimeout(() => setToast(''), 3200)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span><span>ReachInbox</span></div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className="nav-item active"><Icon name="grid" /> Overview</button>
          <button className="nav-item"><Icon name="send" /> Campaigns <span className="nav-count">{stats.scheduled}</span></button>
          <button className="nav-item"><Icon name="users" /> Contacts</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><Icon name="settings" /> Settings</button>
          <div className="plan-card"><span className="plan-label">WORKSPACE</span><strong>Acme Inc.</strong><span>Free plan</span><div className="plan-meter"><i /></div><small>12 of 100 emails used</small></div>
          <div className="profile"><div className="avatar profile-avatar">JD</div><div><strong>Jordan Davis</strong><span>jordan@acme.com</span></div><button aria-label="Account menu">...</button></div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div><div className="top-actions"><a className="oauth-link" href="http://localhost:3001/api/auth/google">Sign in with Google</a><a className="oauth-link slack-link" href="http://localhost:3001/api/slack/connect">Connect Slack</a><button className="icon-button" aria-label="Notifications"><Icon name="bell" /><i className="notification-dot" /></button><div className="top-avatar avatar">JD</div></div></header>
        <div className="content-wrap">
          <section className="page-heading"><div><p className="eyebrow">WEDNESDAY, SEPTEMBER 10, 2026</p><h1>Good morning, Jordan <span>✦</span></h1><p className="heading-copy">Keep your outreach moving. Here&apos;s what&apos;s happening today.</p></div><button className="primary-button" onClick={() => setShowCompose(true)}><Icon name="plus" /> Compose email</button></section>
          <section className="metric-grid"><div className="metric-card"><span className="metric-icon mint"><Icon name="send" /></span><div><span>Scheduled</span><strong>{stats.scheduled}</strong><small><b>+8.2%</b> from last week</small></div></div><div className="metric-card"><span className="metric-icon lavender"><Icon name="send" /></span><div><span>Sent this month</span><strong>248</strong><small><b>+18.4%</b> from last month</small></div></div><div className="metric-card"><span className="metric-icon peach"><Icon name="users" /></span><div><span>Open rate</span><strong>42.8%</strong><small><b>+4.1%</b> from last month</small></div></div><div className="metric-card"><span className="metric-icon sky"><Icon name="bell" /></span><div><span>Replies</span><strong>18</strong><small><b>+12.5%</b> from last month</small></div></div></section>
          <section className="table-section"><div className="section-heading"><div><h2>Email activity</h2><p>Track your scheduled and sent emails in one place.</p></div><button className="secondary-button"><Icon name="search" /> Search</button></div><div className="tabs"><button className={activeTab === 'Scheduled' ? 'tab active' : 'tab'} onClick={() => setActiveTab('Scheduled')}>Scheduled <span>{stats.scheduled}</span></button><button className={activeTab === 'Sent' ? 'tab active' : 'tab'} onClick={() => setActiveTab('Sent')}>Sent <span>{stats.sent}</span></button></div><div className="table-scroll"><table><thead><tr><th>Recipient</th><th>Subject</th><th>{activeTab === 'Scheduled' ? 'Scheduled for' : 'Sent at'}</th><th>Status</th><th /></tr></thead><tbody>{loading ? <tr><td colSpan="5" className="table-message">Loading email activity...</td></tr> : rows.length === 0 ? <tr><td colSpan="5" className="table-message">No {activeTab.toLowerCase()} emails yet.</td></tr> : rows.map((row) => <tr key={row.id}><td><div className="recipient"><span className={`avatar ${row.color}`}>{row.initials}</span><span>{row.email}</span></div></td><td className="subject">{row.subject}</td><td className="date">{row.scheduledAt}</td><td><span className={`status ${row.status.toLowerCase()}`}><i />{row.status}</span></td><td><button className="more-button" aria-label="More options">...</button></td></tr>)}</tbody></table></div><div className="table-footer"><span>Showing {rows.length} of {rows.length} emails</span><div><button disabled>←</button><button>→</button></div></div></section>
        </div>
      </main>
      {showCompose && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCompose(false)}><form className="compose-panel" onSubmit={scheduleEmail}><div className="compose-header"><div><p className="eyebrow">NEW CAMPAIGN</p><h2>Compose email</h2></div><button type="button" className="close-button" onClick={() => setShowCompose(false)}><Icon name="close" /></button></div><label>Subject<input name="subject" placeholder="A thoughtful intro..." required /></label><label>Body<textarea name="body" placeholder="Write your email here..." rows="5" required /></label><div className="upload-box" onClick={() => fileInput.current?.click()}><Icon name="upload" /><strong>{fileName || 'Upload your lead list'}</strong><span>{fileName ? `${leadCount} email addresses detected` : 'CSV or TXT, up to 10MB'}</span><input ref={fileInput} type="file" accept=".csv,.txt" onChange={(event) => event.target.files[0] && parseLeads(event.target.files[0])} /></div><div className="field-row"><label>Start time<input name="scheduledAt" type="datetime-local" required /></label><label>Delay between emails<div className="input-suffix"><input name="delay" type="number" defaultValue="2" min="0" /><span>sec</span></div></label></div><label>Hourly limit<div className="input-suffix"><input name="hourlyLimit" type="number" defaultValue="200" min="1" /><span>emails / hour</span></div></label><button className="primary-button full" type="submit"><Icon name="send" /> Schedule campaign</button></form></div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export default App
