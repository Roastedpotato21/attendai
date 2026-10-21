import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/auth-context";
import { readStaffPhoto } from "@/lib/services/staff-photo";
export const staffPhotoKey = (profile: string | undefined, institution: string | undefined) =>
  ["staff-photo", profile, institution] as const;
export function useStaffPhoto(institution?: string) {
  const { user } = useAuth();
  const active = institution ?? user?.institutionId;
  return useQuery({
    queryKey: staffPhotoKey(user?.id, active),
    queryFn: () => readStaffPhoto(active!),
    enabled: !!user && !!active,
    staleTime: 60_000,
    retry: false,
  });
}
