import { NextRequest } from "next/server";
import { proxyRequest } from "../proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path } = await params;
  return proxyRequest(request, id, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path } = await params;
  return proxyRequest(request, id, path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path } = await params;
  return proxyRequest(request, id, path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path } = await params;
  return proxyRequest(request, id, path);
}
