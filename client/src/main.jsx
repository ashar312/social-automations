import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/lilita-one/400.css'
import '@fontsource-variable/nunito/index.css'
import './index.css'
import App from './App.jsx'
import { GameProvider } from './game/GameProvider.jsx'
import { ProjectProvider } from './projects/ProjectProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <GameProvider>
        <ProjectProvider>
          <App />
        </ProjectProvider>
      </GameProvider>
    </BrowserRouter>
  </StrictMode>,
)
