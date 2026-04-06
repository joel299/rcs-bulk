import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { App } from './App'
import { EmbedPage } from './pages/EmbedPage'

const isEmbed = window.location.pathname === '/embed'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isEmbed ? <EmbedPage /> : <App />}
  </StrictMode>
)
