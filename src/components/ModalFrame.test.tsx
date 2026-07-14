import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmationDialog } from './ConfirmationDialog'
import { ModalFrame } from './ModalFrame'

type ClosePath = 'cancel' | 'escape' | 'confirm'

function StackedModalHarness({ onConfirm = () => undefined }: { onConfirm?: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)

  return (
    <>
      <button type="button">Background before</button>
      <button type="button" onClick={() => setSettingsOpen(true)}>Open Settings</button>
      <button type="button">Background after</button>
      {settingsOpen ? (
        <ModalFrame label="Settings" onClose={() => setSettingsOpen(false)}>
          <h2>Settings</h2>
          <button type="button" onClick={() => setSettingsOpen(false)}>Close Settings</button>
          <button type="button">First settings action</button>
          <button type="button" onClick={() => setConfirmationOpen(true)}>Delete project</button>
          <button type="button">Last settings action</button>
          {confirmationOpen ? (
            <ConfirmationDialog
              label="Delete project"
              title="Delete project"
              message="This permanently removes the selected project."
              confirmLabel="Delete project"
              onCancel={() => setConfirmationOpen(false)}
              onConfirm={() => {
                onConfirm()
                setConfirmationOpen(false)
              }}
            />
          ) : null}
        </ModalFrame>
      ) : null}
    </>
  )
}

function PersistentModalHarness() {
  const [hidden, setHidden] = useState(true)

  return (
    <>
      <button type="button" onClick={() => setHidden(false)}>Open persistent editor</button>
      <ModalFrame label="Persistent editor" hidden={hidden} onClose={() => setHidden(true)}>
        <h2>Persistent editor</h2>
        <button type="button" onClick={() => setHidden(true)}>Hide persistent editor</button>
        <button type="button">Persistent editor action</button>
      </ModalFrame>
    </>
  )
}

function PersistentStackHarness() {
  const [settingsHidden, setSettingsHidden] = useState(true)
  const [confirmationOpen, setConfirmationOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setSettingsHidden(false)}>Open persistent settings</button>
      <ModalFrame label="Persistent Settings" hidden={settingsHidden} onClose={() => setSettingsHidden(true)}>
        <h2>Persistent Settings</h2>
        <button type="button" onClick={() => setConfirmationOpen(true)}>Delete from persistent settings</button>
        <button type="button" onClick={() => setSettingsHidden(true)}>Hide persistent settings</button>
        {confirmationOpen ? (
          <ConfirmationDialog
            label="Confirm persistent deletion"
            title="Confirm persistent deletion"
            message="This confirms a destructive action from persistent settings."
            confirmLabel="Confirm deletion"
            onCancel={() => setConfirmationOpen(false)}
            onConfirm={() => setConfirmationOpen(false)}
          />
        ) : null}
      </ModalFrame>
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ModalFrame focus management', () => {
  it('traps Tab in only the top modal and never moves focus into the background or lower modal', () => {
    render(<StackedModalHarness />)

    const openSettings = screen.getByRole('button', { name: 'Open Settings' })
    openSettings.focus()
    fireEvent.click(openSettings)
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    const closeSettings = within(settings).getByRole('button', { name: 'Close Settings' })
    const lastSettingsAction = within(settings).getByRole('button', { name: 'Last settings action' })

    lastSettingsAction.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(closeSettings).toHaveFocus()

    closeSettings.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(lastSettingsAction).toHaveFocus()

    const deleteTrigger = within(settings).getByRole('button', { name: 'Delete project' })
    deleteTrigger.focus()
    fireEvent.click(deleteTrigger)
    const confirmation = screen.getByRole('dialog', { name: 'Delete project' })
    const cancel = within(confirmation).getByRole('button', { name: 'Cancel' })
    const confirm = within(confirmation).getByRole('button', { name: 'Delete project' })

    confirm.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(cancel).toHaveFocus()

    cancel.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()

    lastSettingsAction.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Background after' })).not.toHaveFocus()
    expect(lastSettingsAction).not.toHaveFocus()
  })

  it.each<ClosePath>(['cancel', 'escape', 'confirm'])(
    'restores focus to the connected confirmation trigger after %s closes the top modal',
    async (closePath) => {
      const onConfirm = vi.fn()
      render(<StackedModalHarness onConfirm={onConfirm} />)

      fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))
      const settings = screen.getByRole('dialog', { name: 'Settings' })
      const deleteTrigger = within(settings).getByRole('button', { name: 'Delete project' })
      deleteTrigger.focus()
      fireEvent.click(deleteTrigger)
      const confirmation = screen.getByRole('dialog', { name: 'Delete project' })

      if (closePath === 'cancel') {
        fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
      } else if (closePath === 'escape') {
        fireEvent.keyDown(window, { key: 'Escape' })
      } else {
        fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete project' }))
      }

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete project' })).not.toBeInTheDocument())
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible()
      expect(deleteTrigger.isConnected).toBe(true)
      expect(deleteTrigger).toHaveFocus()
      expect(onConfirm).toHaveBeenCalledTimes(closePath === 'confirm' ? 1 : 0)
    },
  )

  it('restores the external opener when a mounted ModalFrame becomes hidden', async () => {
    render(<PersistentModalHarness />)

    const opener = screen.getByRole('button', { name: 'Open persistent editor' })
    opener.focus()
    fireEvent.click(opener)
    const editor = screen.getByRole('dialog', { name: 'Persistent editor' })
    const hideEditor = within(editor).getByRole('button', { name: 'Hide persistent editor' })
    hideEditor.focus()
    fireEvent.click(hideEditor)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Persistent editor' })).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
    expect((document.activeElement as HTMLElement).closest('.modal-backdrop-hidden')).toBeNull()
  })

  it('restores focus through a confirmation and then through its persistent lower modal', async () => {
    render(<PersistentStackHarness />)

    const externalOpener = screen.getByRole('button', { name: 'Open persistent settings' })
    externalOpener.focus()
    fireEvent.click(externalOpener)
    const settings = screen.getByRole('dialog', { name: 'Persistent Settings' })
    const confirmationTrigger = within(settings).getByRole('button', { name: 'Delete from persistent settings' })
    confirmationTrigger.focus()
    fireEvent.click(confirmationTrigger)

    const confirmation = screen.getByRole('dialog', { name: 'Confirm persistent deletion' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm persistent deletion' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Persistent Settings' })).toBeVisible()
    await waitFor(() => expect(confirmationTrigger).toHaveFocus())

    const hideSettings = within(settings).getByRole('button', { name: 'Hide persistent settings' })
    hideSettings.focus()
    fireEvent.click(hideSettings)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Persistent Settings' })).not.toBeInTheDocument())
    await waitFor(() => expect(externalOpener).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
    expect((document.activeElement as HTMLElement).closest('.modal-backdrop-hidden')).toBeNull()
  })
})
