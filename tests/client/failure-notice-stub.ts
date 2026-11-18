import { expect, type Page } from '@playwright/test';

/** `@mlearn/ui/failure-notice` stand-in for harness stubs that already import React: alert message, action, detail behind Details. */
export const failureNoticeStub = `
  export const FailureNotice = ({ message, detail, children, testID }) => {
    const [open, setOpen] = React.useState(false);
    return <div data-testid={testID}>
      <span role="alert">{message}</span>
      {children}
      {detail ? <button aria-expanded={open} onClick={() => setOpen(value => !value)}>Details</button> : null}
      {open && detail ? <span data-testid="failure-detail">{detail}</span> : null}
    </div>;
  };
`;

/** The plain sentence is the alert; the raw runtime text is reachable only by opening Details. */
export async function expectFailure(page: Page, message: string, detail: string) {
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page.getByTestId('failure-detail')).toHaveCount(0);
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByTestId('failure-detail')).toContainText(detail);
}
