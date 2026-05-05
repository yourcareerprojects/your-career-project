import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeModeProvider } from '../contexts/ThemeModeContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { NavigationGuardProvider, useNavigationGuardContext } from '../contexts/NavigationGuardContext';
import NavigationConfirmationDialog from './common/NavigationConfirmationDialog';
import Layout from './layout/Layout';
import Home from './pages/Home';
import Profile from './pages/Profile';
import ProfileCreation from './pages/ProfileCreation';
import Login from './pages/Login';
import Register from './pages/Register';
import NotFound from './pages/NotFound';
import SimulationResults from './pages/SimulationResults';
import SavedSimulations from './pages/SavedSimulations';
import SavedSimulationDetails from './pages/SavedSimulationDetails';
import SavedSimulationCareerStepDetails from './pages/SavedSimulationCareerStepDetails';
import SavedCareerSteps from './pages/SavedCareerSteps';
import SavedCareerStepDetails from './pages/SavedCareerStepDetails';
import SimulationResultDetails from './pages/SimulationResultDetails';
import SharedResult from './pages/SharedResult';
import VerifyEmail from './pages/VerifyEmail';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../constants/profileCompletion';
import { useProfileCompletionQuery } from '../hooks/useProfileQueries';

// Protected Route component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const { t } = useTranslation('common');

  if (loading) {
    return <div>{t('app.loading')}</div>; // You might want to create a proper loading component
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return children;
};

/**
 * Runs the profile-completion gate once for all nested routes (Outlet).
 * Previously each route wrapped in ProfileCompletionProtectedRoute remounted on navigation,
 * re-fetching /api/profile/completion and showing a full-page "Loading..." on every click.
 */
const ProfileCompletionOutlet = () => {
  const { isAuthenticated, loading } = useAuth();
  const { t } = useTranslation('common');
  const completionQuery = useProfileCompletionQuery({ enabled: isAuthenticated });

  if (loading || (isAuthenticated && completionQuery.isLoading)) {
    return <div>{t('app.loading')}</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  const overallCompletion = Number(completionQuery.data?.completion?.overall || 0);
  if (completionQuery.isError || overallCompletion < MIN_PROFILE_COMPLETION_REQUIRED) {
    return <Navigate to="/profile" replace />;
  }

  return <Outlet />;
};

const ProtectedOutlet = () => {
  const { isAuthenticated, loading } = useAuth();
  const { t } = useTranslation('common');

  if (loading) {
    return <div>{t('app.loading')}</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

/** Career simulation UX requires an account; guests may only use Home (plus login/register). */
const AuthenticatedSimulationShell = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const { t } = useTranslation('common');

  if (loading) {
    return <div>{t('app.loading')}</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Layout with Navigation Guard
const LayoutWithGuard = ({ children }) => {
  const { getDialogConfig } = useNavigationGuardContext();
  
  return (
    <>
      <Layout>{children}</Layout>
      <NavigationConfirmationDialog {...getDialogConfig()} />
    </>
  );
};

const App = () => {
  return (
    <ThemeModeProvider>
      <AuthProvider>
        <Router>
          <NavigationGuardProvider>
            <LayoutWithGuard>
              <Routes>
              {/* Public routes */}
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route
                path="/simulation"
                element={
                  <AuthenticatedSimulationShell>
                    <SimulationResults />
                  </AuthenticatedSimulationShell>
                }
              />
              <Route
                path="/simulation/results"
                element={
                  <AuthenticatedSimulationShell>
                    <SimulationResults />
                  </AuthenticatedSimulationShell>
                }
              />
              <Route
                path="/simulation/result/:resultId"
                element={
                  <AuthenticatedSimulationShell>
                    <SimulationResultDetails />
                  </AuthenticatedSimulationShell>
                }
              />
              <Route path="/shared-result/:shareId" element={<SharedResult />} />
              <Route path="/verify-email" element={<VerifyEmail />} />

              {/* Saved content: single auth + completion gate so navigation does not re-fetch completion */}
              <Route element={<ProtectedOutlet />}>
                <Route element={<ProfileCompletionOutlet />}>
                  <Route path="/simulations" element={<SavedSimulations />} />
                  <Route path="/simulation/:simulationId" element={<SavedSimulationDetails />} />
                  <Route
                    path="/saved-simulation/:simulationId/career-step/:stepId"
                    element={<SavedSimulationCareerStepDetails />}
                  />
                  <Route path="/saved-steps" element={<SavedCareerSteps />} />
                  <Route path="/saved-career-step/:stepId" element={<SavedCareerStepDetails />} />
                </Route>
              </Route>

              {/* Protected routes */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile showCareerSimulationInputs={false} />
                  </ProtectedRoute>
                }
              />
              <Route path="/profile/create" element={<Navigate to="/profile/fill" replace />} />
              <Route
                path="/profile/fill"
                element={
                  <ProtectedRoute>
                    <ProfileCreation />
                  </ProtectedRoute>
                }
              />

              {/* 404 route */}
              <Route path="*" element={<NotFound />} />
              </Routes>
            </LayoutWithGuard>
          </NavigationGuardProvider>
        </Router>
      </AuthProvider>
    </ThemeModeProvider>
  );
};

export default App; 