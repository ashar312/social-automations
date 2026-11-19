import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter/index.css'
import './index.css'
import App from './App.jsx'
import { ConfirmProvider } from './components/ConfirmProvider.jsx'
import { ProjectProvider } from './projects/ProjectProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ConfirmProvider>
        <ProjectProvider>
          <App />
        </ProjectProvider>
      </ConfirmProvider>
    </BrowserRouter>
  </StrictMode>,
)
