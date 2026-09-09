import { Routes } from '@angular/router';
import { DashboardViewComponent } from './features/dashboard/dashboard-view.component';
import { KanbanViewComponent } from './features/kanban/kanban-view.component';
import { CmsViewComponent } from './features/cms/cms-view.component';

export const routes: Routes = [
  { path: 'dashboard', component: DashboardViewComponent },
  { path: 'kanban', component: KanbanViewComponent },
  { path: 'cms', component: CmsViewComponent },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'dashboard' }
];
