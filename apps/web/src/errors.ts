const ERROR_TEXT: Record<string, string> = {
  invalidInput: '입력 형식이 맞지 않습니다.',
  alreadyInRoom: '이미 다른 방에 들어가 있습니다.',
  roomNotFound: '방이 없어졌습니다.',
  wrongPassword: '비밀번호가 맞지 않습니다.',
  roomFull: '방이 꽉 찼습니다.',
  notInRoom: '방에 들어가 있지 않습니다.',
  drawerCannotChat: '출제자는 채팅할 수 없습니다.',
  alreadyGuessed: '정답을 맞힌 사람은 라운드가 끝날 때까지 채팅할 수 없습니다.',
  timeout: '서버 응답이 없습니다.',
  noWords: '이 카테고리에는 제시어가 없습니다.',
  noDrawings: '저장된 그림이 아직 없습니다. 일반 게임에서 누군가 맞힌 그림이 저장됩니다.',
  notHost: '방장만 설정을 바꿀 수 있습니다.',
  notInLobby: '게임 중에는 바꿀 수 없습니다.',
  imageTooLarge: '이미지가 너무 큽니다.',
  invalidImage: 'PNG, JPEG, WebP 이미지만 올릴 수 있습니다.',
  unauthorized: '다시 로그인하세요.',
  network: '서버에 연결할 수 없습니다.',
  serverError: '서버에서 오류가 났습니다.',
  tooManyPlayers: '지금 인원보다 정원을 줄일 수 없습니다.',
};

export function errorText(code: string): string {
  return ERROR_TEXT[code] ?? '알 수 없는 오류가 났습니다.';
}
