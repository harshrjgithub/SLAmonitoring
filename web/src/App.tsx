import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TicketListPage } from './pages/TicketListPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { NewTicketPage } from './pages/NewTicketPage';
import type { ReactNode } from 'react';
import { EmployeesPage } from './pages/EmployeesPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { NotificationsPage } from './pages/NotificationsPage';

function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <header className="navbar">
      <Link to="/" className="brand"><span className="brand-mark">B</span> BankOps</Link>
      <nav>
        <Link to="/tickets">Tickets</Link>
        <Link to="/dashboard">Dashboard</Link>
        {user.permissions?.includes('manage_employees') && <Link to="/employees">Employees</Link>}
        <Link to="/notifications">Notifications</Link>
        <Link to="/new" className="btn-primary btn-sm">New Ticket</Link>
      </nav>
      <div className="user-menu">
        <span className="user-name">{user.name}</span>
        <span className={`badge role-${user.role}`}>{user.role}</span>
        <button className="btn-ghost btn-sm" onClick={() => { logout(); navigate('/login'); }}>
          Log out
        </button>
      </div>
    </header>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const { user } = useAuth();
  return (
    <div className="app">
      <NavBar />
      <main className="container">
        <Routes>
          <Route path="/login" element={user ? <Navigate to={user.must_change_password ? '/change-password' : '/'} replace /> : <LoginPage />} />
          <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
          <Route path="/" element={<RequireAuth><Navigate to={user?.must_change_password ? '/change-password' : '/dashboard'} replace /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="/employees" element={<RequireAuth><EmployeesPage /></RequireAuth>} />
          <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
          <Route path="/tickets" element={<RequireAuth><TicketListPage /></RequireAuth>} />
          <Route path="/tickets/:id" element={<RequireAuth><TicketDetailPage /></RequireAuth>} />
          <Route path="/new" element={<RequireAuth><NewTicketPage /></RequireAuth>} />
          <Route path="*" element={<div className="center muted">Not found</div>} />
        </Routes>
      </main>
    </div>
  );
}
