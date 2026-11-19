import { createContext, useContext } from 'react'

export const ConfirmContext = createContext(null)
/** Returns confirm({ title, body, confirmLabel, cancelLabel, danger }) => Promise<boolean>. */
export const useConfirm = () => useContext(ConfirmContext)
