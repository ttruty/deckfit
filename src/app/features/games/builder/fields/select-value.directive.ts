import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

/**
 * `<select [value]>` whose options come from `@for`: the native property is set before the options
 * exist, so the browser falls back to the first option. This re-applies the value after rendering.
 */
@Directive({ selector: 'select[value]' })
export class SelectValueDirective {
  readonly value = input<unknown>();
  private readonly el = inject<ElementRef<HTMLSelectElement>>(ElementRef);

  constructor() {
    afterRenderEffect(() => {
      const v = this.value();
      this.el.nativeElement.value = v === null || v === undefined ? '' : String(v);
    });
  }
}
