import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { captureInstallPrompt } from './app/core/pwa/install-prompt';
import { App } from './app/app';

// Must run before the browser fires it (§11 install prompt).
captureInstallPrompt();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
