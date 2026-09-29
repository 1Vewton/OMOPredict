import { createRouter, createWebHistory } from 'vue-router'
import { authGuard } from './guard'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/design' },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/design',
      name: 'design',
      component: () => import('@/views/DesignView.vue'),
    },
    {
      path: '/optimize',
      name: 'optimize',
      component: () => import('@/views/OptimizeView.vue'),
    },
    {
      path: '/tasks/:id',
      name: 'task-detail',
      component: () => import('@/views/TaskDetailView.vue'),
      props: true,
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@/views/HistoryView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/design' },
  ],
})

// 守卫实现见 ./guard.ts（独立模块，便于单测）
router.beforeEach(authGuard)

export default router
