import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateMemberRequest,
  MemberDetail,
  PaginatedMembersResponse,
  UpdateMemberRequest,
  UpdateMemberSelfRequest,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export const membersKeys = {
  all: ['members'] as const,
  list: (query?: string) =>
    [...membersKeys.all, 'list', query ?? 'default'] as const,
  me: () => [...membersKeys.all, 'me'] as const,
  byCode: (code: string) => [...membersKeys.all, 'code', code] as const,
};

export const membersApi = {
  getAll: (query = 'limit=100') =>
    apiClient<PaginatedMembersResponse>(`/members?${query}`),
  getMine: () => apiClient<MemberDetail>('/members/me'),
  getByCode: (memberCode: string) =>
    apiClient<MemberDetail>(`/members/code/${encodeURIComponent(memberCode)}`),
  getById: (id: string) => apiClient<MemberDetail>(`/members/${id}`),
  create: (input: CreateMemberRequest) =>
    apiClient<MemberDetail>('/members', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateMemberRequest) =>
    apiClient<MemberDetail>(`/members/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  updateMine: (input: UpdateMemberSelfRequest) =>
    apiClient<MemberDetail>('/members/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};

export function useMembersList(query = 'limit=100') {
  return useQuery({
    queryKey: membersKeys.list(query),
    queryFn: () => membersApi.getAll(query),
  });
}

export function useMyMemberProfile() {
  return useQuery({
    queryKey: membersKeys.me(),
    queryFn: () => membersApi.getMine(),
  });
}

export function useUpdateMemberPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      memberId,
      idPhotoUrl,
    }: {
      memberId: string;
      idPhotoUrl: string;
    }) => membersApi.update(memberId, { idPhotoUrl }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKeys.all });
    },
  });
}
