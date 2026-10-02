import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ version: '0.5.0' });
}