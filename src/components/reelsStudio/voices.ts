export interface VoiceOption {
  id: string;
  label: string;
  hint: string;
  gender: 'male' | 'female';
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'Wise_Woman',         label: 'Aurora',  hint: 'Feminina · calma · autoridade',  gender: 'female' },
  { id: 'Friendly_Person',    label: 'Léo',     hint: 'Masculina · amigável · próxima', gender: 'male'   },
  { id: 'Patient_Man',        label: 'Tomás',   hint: 'Masculina · paciente · grave',   gender: 'male'   },
  { id: 'Inspirational_girl', label: 'Maya',    hint: 'Feminina · jovem · energia',     gender: 'female' },
  { id: 'Deep_Voice_Man',     label: 'Hugo',    hint: 'Masculina · profunda · narrador', gender: 'male'  },
  { id: 'Casual_Guy',         label: 'Rico',    hint: 'Masculina · descontraída',       gender: 'male'   },
  { id: 'Lively_Girl',        label: 'Lila',    hint: 'Feminina · vibrante · alegre',   gender: 'female' },
  { id: 'Calm_Woman',         label: 'Sofia',   hint: 'Feminina · serena · mentora',    gender: 'female' },
];

export const getVoice = (id: string): VoiceOption =>
  VOICE_OPTIONS.find(v => v.id === id) ?? VOICE_OPTIONS[0];
