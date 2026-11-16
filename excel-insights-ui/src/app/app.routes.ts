import { Routes } from '@angular/router';
import { HomeComponent } from './features/home/home.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { LandingLayoutComponent } from './features/home/layout/landing-layout.component';
import { FeaturesComponent } from './features/home/features/features.component';
import { HowItWorksComponent } from './features/home/how-it-works/how-it-works.component';
import { PricingComponent } from './features/home/pricing/pricing.component';

export const routes: Routes = [
  {
    path: '',
    component: LandingLayoutComponent,
    children: [
      {
        path: '',
        component: HomeComponent
      },
      {
        path: 'features',
        component: FeaturesComponent
      },
      {
        path: 'how-it-works',
        component: HowItWorksComponent
      },
      {
        path: 'pricing',
        component: PricingComponent
      }
    ]
  },

  {
    path: 'dashboard',
    component: DashboardComponent
  }
];