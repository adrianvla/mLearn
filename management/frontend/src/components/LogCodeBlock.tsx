import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockItem,
} from '@/components/kibo-ui/code-block';

interface LogCodeBlockProps {
  filename: string;
  code: string;
}

export function LogCodeBlock({ filename, code }: LogCodeBlockProps): React.ReactElement {
  return (
    <CodeBlock className="max-h-[68vh]" data={[{ filename, language: 'log', code }]} defaultValue={filename}>
      <CodeBlockHeader>
        <CodeBlockFilename value={filename}>{filename}</CodeBlockFilename>
        <CodeBlockCopyButton className="ml-auto" />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem className="log-scrollbar max-h-[62vh] overflow-auto text-xs" key={item.filename} lineNumbers={false} value={item.filename}>
            <CodeBlockContent language="log" syntaxHighlighting={false}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}
