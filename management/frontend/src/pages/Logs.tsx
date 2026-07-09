import { useEffect, useRef, useState } from 'react';
import { Card, Chip, Button, Select, ListBox } from '@heroui/react';
import { RefreshCw, Copy, Check, AlertTriangle } from 'lucide-react';
import { useApi, api } from '../hooks/useApi';
import { PageContainer, PageHeader, LoadingState, ErrorState } from '../components/shared';
import { redactLine } from '../redact';
import type { LogsDto } from '../api/types';

const TAIL_OPTIONS: number[] = [50, 100, 300, 500];

export default function Logs() {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [tail, setTail] = useState<number>(300);
  const [copied, setCopied] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const servicesApi = useApi(() => api.getServices(), []);
  const logsApi = useApi<LogsDto | null>(
    () => (selectedService === null ? Promise.resolve(null) : api.getLogs(selectedService, tail)),
    [selectedService, tail],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null) {
      node.scrollTop = node.scrollHeight;
    }
  }, [logsApi.data]);

  const handleCopy = async (): Promise<void> => {
    const data = logsApi.data;
    if (data === null) return;
    const text = data.lines
      .map((line) => {
        const prefix = line.timestamp === null ? '' : `${line.timestamp} `;
        return `${prefix}${line.message}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const services = servicesApi.data ?? [];
  const logs = logsApi.data;
  const hasOutput = logs !== null && logs.lines.length > 0;

  return (
    <PageContainer>
      <PageHeader title="Logs" subtitle="Tail and inspect container log output with automatic secret redaction" />

      {servicesApi.error !== null && (
        <div className="mb-4">
          <ErrorState message={`Failed to load services: ${servicesApi.error}`} />
        </div>
      )}

      <Card className="mb-4">
        <Card.Content>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Service</span>
              <Select
                selectedKey={selectedService ?? ''}
                onSelectionChange={(key) => setSelectedService(key === null ? null : String(key))}
                isDisabled={services.length === 0}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="">Select a service</ListBox.Item>
                    {services.map((service) => (
                      <ListBox.Item key={service.id} id={service.id}>
                        {service.service_name ?? service.container_name}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Lines</span>
              <Select
                selectedKey={String(tail)}
                onSelectionChange={(key) => setTail(Number(key))}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {TAIL_OPTIONS.map((value) => (
                      <ListBox.Item key={value} id={String(value)}>
                        {value} lines
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <Button
              variant="secondary"
              isDisabled={selectedService === null}
              onPress={logsApi.refetch}
            >
              <RefreshCw className={logsApi.loading && selectedService !== null ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
          </div>
        </Card.Content>
      </Card>

      {logsApi.error !== null ? (
        <ErrorState message={logsApi.error} />
      ) : (
        <Card>
          <Card.Header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Card.Title>Output</Card.Title>
              {logs !== null && logs.truncated && (
                <Chip size="sm" color="warning" variant="soft">
                  <span className="inline-flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Truncated
                  </span>
                </Chip>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!hasOutput}
              onPress={handleCopy}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </Card.Header>
          <Card.Content>
            {selectedService === null ? (
              <div className="flex h-64 items-center justify-center text-muted">
                Select a service to view logs
              </div>
            ) : logsApi.loading && logs === null ? (
              <LoadingState label="Loading logs…" />
            ) : hasOutput ? (
              <div
                ref={scrollRef}
                className="h-[30rem] overflow-auto rounded-lg bg-surface-secondary p-3 font-mono text-xs leading-relaxed"
              >
                {logs.lines.map((line, index) => (
                  <div key={`${line.timestamp ?? index}-${index}`} className="whitespace-pre-wrap break-words">
                    {line.timestamp !== null && (
                      <span className="text-muted">{line.timestamp} </span>
                    )}
                    <span className={line.stream === 'stderr' ? 'text-danger' : 'text-foreground'}>
                      {redactLine(line.message)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center text-muted">
                No log output for this service
              </div>
            )}
          </Card.Content>
        </Card>
      )}
    </PageContainer>
  );
}
