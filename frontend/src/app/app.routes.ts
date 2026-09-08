import { Routes } from '@angular/router';
import { KanbanViewComponent } from './features/kanban/kanban-view.component';
import { CmsViewComponent } from './features/cms/cms-view.component';

export const routes: Routes = [
  { path: 'kanban', component: KanbanViewComponent },
  { path: 'cms', component: CmsViewComponent },
  { path: '', redirectTo: 'kanban', pathMatch: 'full' },
  { path: '**', redirectTo: 'kanban' }
];
