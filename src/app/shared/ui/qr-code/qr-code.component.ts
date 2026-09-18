import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/** QR code as an inline SVG path (no network, no innerHTML). Dark modules in ink on paper. */
@Component({
  selector: 'df-qr-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let q = qr();
    <svg [attr.viewBox]="'0 0 ' + q.size + ' ' + q.size" role="img" [attr.aria-label]="label()" shape-rendering="crispEdges">
      <rect [attr.width]="q.size" [attr.height]="q.size" class="bg" />
      <path [attr.d]="q.path" class="fg" />
    </svg>
  `,
  styles: `
    :host { display: block; width: var(--qr-size, 180px); aspect-ratio: 1; }
    svg { width: 100%; height: 100%; display: block; border-radius: 8px; }
    .bg { fill: #ffffff; }
    .fg { fill: #1f2a44; }
  `,
})
export class QrCodeComponent {
  readonly text = input.required<string>();
  readonly label = input('QR code');

  protected readonly qr = computed(() => {
    const code = qrcode(0, 'M');
    code.addData(this.text());
    code.make();
    const n = code.getModuleCount();
    const margin = 2; // quiet zone, in modules
    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (code.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
    return { size: n + margin * 2, path };
  });
}
