import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

type Theme = 'light' | 'dark' | 'system';
const THEME_STORAGE_KEY = 'craftkeeper.theme';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  theme: Theme = 'system';

  constructor() {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') this.theme = saved;
    } catch { /* The workspace remains usable when preference storage is unavailable. */ }
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Keep the current selection for this session. */ }
  }

}