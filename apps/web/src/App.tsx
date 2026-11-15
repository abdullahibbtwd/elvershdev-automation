import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './layout/DashboardLayout';
import { AnalyticsCostsPage } from './pages/AnalyticsCostsPage';
import { AnalyticsInsightsPage } from './pages/AnalyticsInsightsPage';
import { AnalyticsOverviewPage } from './pages/AnalyticsOverviewPage';
import { AnalyticsVideoDetailPage } from './pages/AnalyticsVideoDetailPage';
import { AutomationCalendarPage } from './pages/AutomationCalendarPage';
import { AutomationDashboardPage } from './pages/AutomationDashboardPage';
import { AutomationExecutionsPage } from './pages/AutomationExecutionsPage';
import { AutomationSettingsPage } from './pages/AutomationSettingsPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { JobsPage } from './pages/JobsPage';
import { LoginPage } from './pages/LoginPage';
import { MediaPage } from './pages/MediaPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { PublishingPage } from './pages/PublishingPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { StoriesPage } from './pages/StoriesPage';
import { StoryCreatePage } from './pages/StoryCreatePage';
import { StoryDetailPage } from './pages/StoryDetailPage';
import { SystemOpsPage } from './pages/SystemOpsPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<OverviewPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/stories" element={<StoriesPage />} />
        <Route path="/stories/new" element={<StoryCreatePage />} />
        <Route path="/stories/:id" element={<StoryDetailPage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/publishing" element={<PublishingPage />} />
        <Route path="/automation" element={<AutomationDashboardPage />} />
        <Route path="/automation/calendar" element={<AutomationCalendarPage />} />
        <Route path="/automation/settings" element={<AutomationSettingsPage />} />
        <Route path="/automation/executions" element={<AutomationExecutionsPage />} />
        <Route path="/analytics" element={<AnalyticsOverviewPage />} />
        <Route path="/analytics/videos/:videoId" element={<AnalyticsVideoDetailPage />} />
        <Route path="/analytics/costs" element={<AnalyticsCostsPage />} />
        <Route path="/analytics/insights" element={<AnalyticsInsightsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/system" element={<SystemOpsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
