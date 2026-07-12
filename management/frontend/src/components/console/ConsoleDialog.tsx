import { Modal, useOverlayState } from "@heroui/react";
import type { ReactNode } from "react";

export function ConsoleDialog({ open, onOpenChange, title, children, footer }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const state = useOverlayState({ isOpen: open, onOpenChange });
  if (!open) return null;
  return <Modal state={state}>
    <Modal.Backdrop>
      <Modal.Container>
        <Modal.Dialog aria-label={title}>
          <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
          <Modal.Body>{children}</Modal.Body>
          {footer && <Modal.Footer>{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}
