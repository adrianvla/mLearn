/**
 * Owns the "Add all" confirmation lifecycle for every unknown-words sidebar.
 *
 * Creating flashcards is easy to repeat and hard to undo, so the sidebar's Add
 * All control stops and shows exactly what is about to be created. The reader
 * and the video show that same confirmation, and both used to own the lifecycle
 * around it independently - whether it was open, which two entry lists it was
 * opened with, and closing it again. Those are the same transitions on both
 * surfaces, so any change to how the confirmation opens or closes had to be made
 * twice and could be made wrongly once.
 *
 * This owns those transitions once. What stays with each surface is only what
 * genuinely differs: the words it offers (built from its own material), and the
 * wording that names that material.
 */
import { Component, type JSX, createSignal } from 'solid-js';
import { AddAllFlashcardsModal, type AddAllFlashcardsModalLabels } from '../../windows/main/routes/components/AddAllFlashcardsModal';
import type { SidebarWordEntry } from './UnknownWordsSidebar';

interface AddAllFlashcardsHostProps {
  labels: AddAllFlashcardsModalLabels;
  /** Entries the learner confirmed. The host hands these straight back. */
  onAdd: (entries: SidebarWordEntry[]) => void;
  /**
   * The sidebar, rendered with the controller for opening the confirmation.
   *
   * The confirm is deliberately not handed to the sidebar as ready-made state:
   * each surface would then own a piece of the open/close lifecycle again, which
   * is what this exists to end. Handing it a controller keeps every transition
   * here and leaves the surface with only the entries and the wording.
   */
  children: (host: AddAllFlashcardsController) => JSX.Element;
}

export interface AddAllFlashcardsController {
  /** Opens the confirmation for the entries the sidebar could add. */
  open: (addableEntries: SidebarWordEntry[], dictionaryFoundAddable: SidebarWordEntry[]) => void;
  close: () => void;
}

export const AddAllFlashcardsHost: Component<AddAllFlashcardsHostProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [allEntries, setAllEntries] = createSignal<SidebarWordEntry[]>([]);
  const [dictionaryEntries, setDictionaryEntries] = createSignal<SidebarWordEntry[]>([]);

  const open: AddAllFlashcardsController['open'] = (addable, dictionaryFound) => {
    setAllEntries(addable);
    setDictionaryEntries(dictionaryFound);
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  const controller: AddAllFlashcardsController = { open, close };

  return (
    <>
      {props.children(controller)}
      <AddAllFlashcardsModal
        isOpen={isOpen()}
        onClose={close}
        allEntries={allEntries()}
        dictionaryEntries={dictionaryEntries()}
        labels={props.labels}
        onAdd={(entries) => {
          props.onAdd(entries as SidebarWordEntry[]);
          close();
        }}
      />
    </>
  );
};
