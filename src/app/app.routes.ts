import { Routes } from '@angular/router';
import { AlchemyEstimatorComponent } from './alchemy/estimator.component';
import { ResourcesComponent } from './resources/resources.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'alchemy' },
  { path: 'alchemy', component: AlchemyEstimatorComponent },
  { path: 'resources', component: ResourcesComponent },
  { path: '**', redirectTo: 'alchemy' }
];
