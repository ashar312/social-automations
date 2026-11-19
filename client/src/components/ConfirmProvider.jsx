import { useCallback, useState } from 'react'
import { Modal } from './ui.jsx'
import { ConfirmContext } from './useConfirm.js'

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const confirm = useCallback((options) => new Promise((resolve) => setDialog({ ...options, resolve })), [])
  const close = (answer) => { dialog?.resolve(answer); setDialog(null) }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <Modal onClose={() => close(false)} label={dialog.title}>
          <h2 className="text-lg font-semibold">{dialog.title}</h2>
          {dialog.body && <p className="mt-2 text-sm text-muted">{dialog.body}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2.5">
            <button autoFocus onClick={() => close(false)} className="btn">{dialog.cancelLabel || 'Cancel'}</button>
            <button onClick={() => close(true)} className={`btn ${dialog.danger ? 'btn-danger-solid' : 'btn-primary'}`}>{dialog.confirmLabel || 'Confirm'}</button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}
