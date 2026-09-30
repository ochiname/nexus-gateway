import jwt from 'jsonwebtoken';

export class AuthService {
  private static MOCK_USERS = [
    { username: 'free_user', password: 'password123', tier: 'free' },
    { username: 'enterprise_user', password: 'password123', tier: 'enterprise' }
  ];

  public static authenticate(username: string, password: string) {
    const user = AuthService.MOCK_USERS.find(
      (u) => u.username === username && u.password === password
    );

    if (!user) return null;

    // Read dynamically so it always grabs the live env variable
    const secret = process.env.JWT_SECRET || 'fallback_secret';

    const token = jwt.sign(
      { username: user.username, tier: user.tier },
      secret,
      { expiresIn: '1h' }
    );

    return { token, tier: user.tier };
  }
}