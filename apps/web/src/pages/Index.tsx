import React from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { AdminDashboard } from '@/components/dashboard/AdminDashboard';
import { MemberDashboard } from '@/components/dashboard/MemberDashboard';

export default function Index() {
  const { user, loading } = useAuthStore();

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><div className="w-6 h-6 border-2 border-purple-500 rounded-full animate-spin border-t-transparent"></div></div>;
  }

  if (user?.role === 'admin') {
    return <AdminDashboard />;
  }

  return <MemberDashboard />;
}