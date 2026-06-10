import { createContext, useContext } from 'react';

export const ProfileMobileSnapContext = createContext(false);

export function useProfileMobileSnapActive() {
  return useContext(ProfileMobileSnapContext);
}
