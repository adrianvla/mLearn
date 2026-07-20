export type AppUpdateSupportReason =
  | 'development'
  | 'windows-portable'
  | 'linux-non-appimage'
  | 'unsupported-platform';

export type AppUpdateErrorCode =
  | 'native-check-failed'
  | 'metadata-check-failed'
  | 'invalid-update-metadata'
  | 'download-failed'
  | 'download-not-available'
  | 'download-unsupported'
  | 'install-failed'
  | 'install-not-ready';

export type AppUpdateOperation = 'check' | 'download' | 'install';

export interface AppUpdateProgress {
  readonly percent: number;
  readonly bytesPerSecond: number;
  readonly transferred: number;
  readonly total: number;
}

export interface AppUpdateDetails {
  readonly version: string;
  readonly source: 'native' | 'metadata';
  readonly releaseName?: string;
  readonly releaseNotes?: string;
  readonly releaseDate?: string;
  readonly manualDownloadUrl?: string;
}

interface AppUpdateStateBase {
  readonly currentVersion: string;
  readonly availableVersion?: string;
  readonly canAutoUpdate: boolean;
  readonly supportReason: AppUpdateSupportReason | null;
  readonly updatedAt: number;
}

export type AppUpdateState = AppUpdateStateBase & (
  | {
      readonly status: 'idle' | 'checking' | 'up-to-date';
    }
  | {
      readonly status: 'available';
      readonly update: AppUpdateDetails;
    }
  | {
      readonly status: 'downloading';
      readonly update: AppUpdateDetails;
      readonly progress: AppUpdateProgress;
    }
  | {
      readonly status: 'downloaded' | 'installing';
      readonly update: AppUpdateDetails;
    }
  | {
      readonly status: 'error';
      readonly operation: AppUpdateOperation;
      readonly errorCode: AppUpdateErrorCode;
      readonly retryable: boolean;
      readonly update?: AppUpdateDetails;
    }
);

export interface InitializeAppUpdaterOptions {
  readonly autoCheck?: boolean;
}
