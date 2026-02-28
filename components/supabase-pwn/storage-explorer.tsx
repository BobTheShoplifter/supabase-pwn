"use client"

import { useCallback, useRef, useState } from "react"
import {
  FolderOpen,
  Upload,
  Download,
  Trash2,
  Link,
  Copy,
  RefreshCw,
} from "lucide-react"

import { useSupabase } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BucketInfo = {
  id: string
  name: string
  public: boolean
  created_at: string
  updated_at: string
}

type FileObject = {
  name: string
  id?: string
  created_at?: string
  updated_at?: string
  last_accessed_at?: string
  metadata?: {
    size?: number
    mimetype?: string
    [key: string]: unknown
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-"
  try {
    return new Date(dateStr).toLocaleString()
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// StorageExplorer
// ---------------------------------------------------------------------------

export function StorageExplorer() {
  const { client, addLog } = useSupabase()

  // -- Bucket state ---------------------------------------------------------
  const [buckets, setBuckets] = useState<BucketInfo[]>([])
  const [selectedBucket, setSelectedBucket] = useState<string>("")
  const [loadingBuckets, setLoadingBuckets] = useState(false)

  // -- List files state -----------------------------------------------------
  const [listFolder, setListFolder] = useState("")
  const [listLimit, setListLimit] = useState(100)
  const [files, setFiles] = useState<FileObject[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  // -- Upload state ---------------------------------------------------------
  const [uploadPath, setUploadPath] = useState("")
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // -- Download state -------------------------------------------------------
  const [downloadPath, setDownloadPath] = useState("")
  const [downloading, setDownloading] = useState(false)

  // -- Delete state ---------------------------------------------------------
  const [deletePaths, setDeletePaths] = useState("")
  const [deleting, setDeleting] = useState(false)

  // -- Public URL state -----------------------------------------------------
  const [publicUrlPath, setPublicUrlPath] = useState("")
  const [publicUrl, setPublicUrl] = useState("")

  // -- Signed URL state -----------------------------------------------------
  const [signedUrlPath, setSignedUrlPath] = useState("")
  const [signedUrlExpiry, setSignedUrlExpiry] = useState(3600)
  const [signedUrl, setSignedUrl] = useState("")
  const [creatingSignedUrl, setCreatingSignedUrl] = useState(false)

  // -- Bucket operations ----------------------------------------------------

  const handleListBuckets = useCallback(async () => {
    if (!client) return
    setLoadingBuckets(true)
    try {
      addLog("info", "Listing storage buckets...")
      const { data, error } = await client.storage.listBuckets()
      if (error) {
        addLog("error", `Failed to list buckets: ${error.message}`, error)
        return
      }
      const bucketList = (data ?? []) as BucketInfo[]
      setBuckets(bucketList)
      addLog(
        "success",
        `Found ${bucketList.length} bucket(s)`,
        bucketList.map((b) => ({ name: b.name, public: b.public })),
      )
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Unknown error listing buckets",
        err,
      )
    } finally {
      setLoadingBuckets(false)
    }
  }, [client, addLog])

  // -- File list ------------------------------------------------------------

  const handleListFiles = useCallback(async () => {
    if (!client || !selectedBucket) return
    setLoadingFiles(true)
    try {
      const folder = listFolder.trim() || undefined
      addLog(
        "info",
        `Listing files in "${selectedBucket}" ${folder ? `folder="${folder}"` : "(root)"} limit=${listLimit}`,
      )
      const { data, error } = await client.storage
        .from(selectedBucket)
        .list(folder, { limit: listLimit })
      if (error) {
        addLog("error", `Failed to list files: ${error.message}`, error)
        return
      }
      const fileList = (data ?? []) as FileObject[]
      setFiles(fileList)
      addLog("success", `Listed ${fileList.length} item(s)`, fileList)
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Unknown error listing files",
        err,
      )
    } finally {
      setLoadingFiles(false)
    }
  }, [client, selectedBucket, listFolder, listLimit, addLog])

  // -- Upload ---------------------------------------------------------------

  const handleUpload = useCallback(async () => {
    if (!client || !selectedBucket) return
    const fileEl = fileInputRef.current
    const file = fileEl?.files?.[0]
    if (!file) {
      addLog("warning", "No file selected for upload")
      return
    }
    const dest = uploadPath.trim()
    if (!dest) {
      addLog("warning", "Destination path is required for upload")
      return
    }
    setUploading(true)
    try {
      addLog("info", `Uploading "${file.name}" to "${selectedBucket}/${dest}"`)
      const { data, error } = await client.storage
        .from(selectedBucket)
        .upload(dest, file)
      if (error) {
        addLog("error", `Upload failed: ${error.message}`, error)
        return
      }
      addLog("success", `Upload succeeded: ${dest}`, data)
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Unknown error during upload",
        err,
      )
    } finally {
      setUploading(false)
    }
  }, [client, selectedBucket, uploadPath, addLog])

  // -- Download -------------------------------------------------------------

  const handleDownload = useCallback(async () => {
    if (!client || !selectedBucket) return
    const path = downloadPath.trim()
    if (!path) {
      addLog("warning", "File path is required for download")
      return
    }
    setDownloading(true)
    try {
      addLog("info", `Downloading "${selectedBucket}/${path}"`)
      const { data, error } = await client.storage
        .from(selectedBucket)
        .download(path)
      if (error) {
        addLog("error", `Download failed: ${error.message}`, error)
        return
      }
      if (data) {
        const blobUrl = URL.createObjectURL(data)
        addLog("success", `Download succeeded. Blob URL: ${blobUrl}`, {
          path,
          blobUrl,
          size: data.size,
          type: data.type,
        })
        // Trigger browser download
        const a = document.createElement("a")
        a.href = blobUrl
        a.download = path.split("/").pop() || "download"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Unknown error during download",
        err,
      )
    } finally {
      setDownloading(false)
    }
  }, [client, selectedBucket, downloadPath, addLog])

  // -- Delete ---------------------------------------------------------------

  const handleDelete = useCallback(async () => {
    if (!client || !selectedBucket) return
    const raw = deletePaths.trim()
    if (!raw) {
      addLog("warning", "File path(s) required for delete")
      return
    }
    const paths = raw.split(",").map((p) => p.trim()).filter(Boolean)
    setDeleting(true)
    try {
      addLog(
        "info",
        `Deleting ${paths.length} file(s) from "${selectedBucket}": ${paths.join(", ")}`,
      )
      const { data, error } = await client.storage
        .from(selectedBucket)
        .remove(paths)
      if (error) {
        addLog("error", `Delete failed: ${error.message}`, error)
        return
      }
      addLog("success", `Deleted ${paths.length} file(s)`, data)
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Unknown error during delete",
        err,
      )
    } finally {
      setDeleting(false)
    }
  }, [client, selectedBucket, deletePaths, addLog])

  // -- Public URL -----------------------------------------------------------

  const handleGetPublicUrl = useCallback(() => {
    if (!client || !selectedBucket) return
    const path = publicUrlPath.trim()
    if (!path) {
      addLog("warning", "File path is required for public URL")
      return
    }
    const { data } = client.storage
      .from(selectedBucket)
      .getPublicUrl(path)
    setPublicUrl(data.publicUrl)
    addLog("success", `Public URL: ${data.publicUrl}`, {
      path,
      publicUrl: data.publicUrl,
    })
  }, [client, selectedBucket, publicUrlPath, addLog])

  // -- Signed URL -----------------------------------------------------------

  const handleCreateSignedUrl = useCallback(async () => {
    if (!client || !selectedBucket) return
    const path = signedUrlPath.trim()
    if (!path) {
      addLog("warning", "File path is required for signed URL")
      return
    }
    setCreatingSignedUrl(true)
    try {
      addLog(
        "info",
        `Creating signed URL for "${selectedBucket}/${path}" (${signedUrlExpiry}s)`,
      )
      const { data, error } = await client.storage
        .from(selectedBucket)
        .createSignedUrl(path, signedUrlExpiry)
      if (error) {
        addLog("error", `Signed URL failed: ${error.message}`, error)
        return
      }
      if (data) {
        setSignedUrl(data.signedUrl)
        addLog("success", `Signed URL: ${data.signedUrl}`, {
          path,
          signedUrl: data.signedUrl,
          expiresIn: signedUrlExpiry,
        })
      }
    } catch (err) {
      addLog(
        "error",
        err instanceof Error
          ? err.message
          : "Unknown error creating signed URL",
        err,
      )
    } finally {
      setCreatingSignedUrl(false)
    }
  }, [client, selectedBucket, signedUrlPath, signedUrlExpiry, addLog])

  // -- Copy to clipboard helper ---------------------------------------------

  const copyToClipboard = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(
        () => addLog("info", "Copied to clipboard"),
        () => addLog("warning", "Failed to copy to clipboard"),
      )
    },
    [addLog],
  )

  // =========================================================================
  // Render
  // =========================================================================

  if (!client) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Connect to a Supabase project first.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* ----------------------------------------------------------------- */}
      {/* Bucket Section                                                    */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleListBuckets}
              disabled={loadingBuckets}
            >
              {loadingBuckets ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              List Buckets
            </Button>

            {buckets.length > 0 && (
              <Select
                value={selectedBucket}
                onValueChange={setSelectedBucket}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select a bucket" />
                </SelectTrigger>
                <SelectContent>
                  {buckets.map((b) => (
                    <SelectItem key={b.id} value={b.name}>
                      <span className="flex items-center gap-2">
                        {b.name}
                        <Badge
                          variant={b.public ? "default" : "secondary"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {b.public ? "public" : "private"}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {selectedBucket && (
              <Badge variant="outline" className="text-xs">
                {selectedBucket}
                {buckets.find((b) => b.name === selectedBucket)?.public
                  ? " (public)"
                  : " (private)"}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Operations (visible after selecting a bucket)                     */}
      {/* ----------------------------------------------------------------- */}
      {selectedBucket && (
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="list" className="gap-1 text-xs">
              <FolderOpen className="size-3.5" />
              List
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1 text-xs">
              <Upload className="size-3.5" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="download" className="gap-1 text-xs">
              <Download className="size-3.5" />
              Download
            </TabsTrigger>
            <TabsTrigger value="delete" className="gap-1 text-xs">
              <Trash2 className="size-3.5" />
              Delete
            </TabsTrigger>
            <TabsTrigger value="public-url" className="gap-1 text-xs">
              <Link className="size-3.5" />
              Public URL
            </TabsTrigger>
            <TabsTrigger value="signed-url" className="gap-1 text-xs">
              <Link className="size-3.5" />
              Signed URL
            </TabsTrigger>
          </TabsList>

          {/* -------------------------------------------------------------- */}
          {/* List Files                                                      */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="list">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-end gap-3">
                  <div className="space-y-1.5 flex-1">
                    <Label htmlFor="list-folder">Folder Path</Label>
                    <Input
                      id="list-folder"
                      placeholder="(empty = root)"
                      value={listFolder}
                      onChange={(e) => setListFolder(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 w-28">
                    <Label htmlFor="list-limit">Limit</Label>
                    <Input
                      id="list-limit"
                      type="number"
                      min={1}
                      value={listLimit}
                      onChange={(e) =>
                        setListLimit(parseInt(e.target.value, 10) || 100)
                      }
                    />
                  </div>
                  <Button
                    onClick={handleListFiles}
                    disabled={loadingFiles}
                    size="sm"
                  >
                    {loadingFiles ? (
                      <RefreshCw className="size-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="size-3.5" />
                    )}
                    List
                  </Button>
                </div>

                {files.length > 0 && (
                  <>
                    <Separator />
                    <ScrollArea className="max-h-72">
                      <div className="space-y-1">
                        {/* Header */}
                        <div className="grid grid-cols-3 gap-2 px-2 text-[11px] font-medium text-muted-foreground">
                          <span>Name</span>
                          <span>Last Modified</span>
                          <span>Size</span>
                        </div>
                        {files.map((f, i) => (
                          <div
                            key={`${f.name}-${i}`}
                            className="grid grid-cols-3 gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40 font-mono"
                          >
                            <span className="truncate">{f.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(f.updated_at ?? f.created_at)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {f.metadata?.size != null
                                ? formatBytes(f.metadata.size)
                                : "-"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Upload                                                          */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="upload">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="upload-file">File</Label>
                  <Input id="upload-file" type="file" ref={fileInputRef} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="upload-path">Destination Path</Label>
                  <Input
                    id="upload-path"
                    placeholder="e.g. folder/file.png"
                    value={uploadPath}
                    onChange={(e) => setUploadPath(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleUpload}
                  disabled={uploading}
                  size="sm"
                >
                  {uploading ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  Upload
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Download                                                        */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="download">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="download-path">File Path</Label>
                  <Input
                    id="download-path"
                    placeholder="e.g. folder/file.png"
                    value={downloadPath}
                    onChange={(e) => setDownloadPath(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleDownload}
                  disabled={downloading}
                  size="sm"
                >
                  {downloading ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  Download
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Delete                                                          */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="delete">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="delete-paths">
                    File Path(s){" "}
                    <span className="text-muted-foreground font-normal">
                      (comma-separated)
                    </span>
                  </Label>
                  <Input
                    id="delete-paths"
                    placeholder="e.g. folder/a.png, folder/b.png"
                    value={deletePaths}
                    onChange={(e) => setDeletePaths(e.target.value)}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                  size="sm"
                >
                  {deleting ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Delete
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Public URL                                                      */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="public-url">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="public-url-path">File Path</Label>
                  <Input
                    id="public-url-path"
                    placeholder="e.g. folder/file.png"
                    value={publicUrlPath}
                    onChange={(e) => setPublicUrlPath(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleGetPublicUrl}
                  size="sm"
                >
                  <Link className="size-3.5" />
                  Get Public URL
                </Button>
                {publicUrl && (
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={publicUrl}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(publicUrl)}
                      title="Copy URL"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------------- */}
          {/* Signed URL                                                      */}
          {/* -------------------------------------------------------------- */}
          <TabsContent value="signed-url">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-end gap-3">
                  <div className="space-y-1.5 flex-1">
                    <Label htmlFor="signed-url-path">File Path</Label>
                    <Input
                      id="signed-url-path"
                      placeholder="e.g. folder/file.png"
                      value={signedUrlPath}
                      onChange={(e) => setSignedUrlPath(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 w-32">
                    <Label htmlFor="signed-url-expiry">Expiry (seconds)</Label>
                    <Input
                      id="signed-url-expiry"
                      type="number"
                      min={1}
                      value={signedUrlExpiry}
                      onChange={(e) =>
                        setSignedUrlExpiry(
                          parseInt(e.target.value, 10) || 3600,
                        )
                      }
                    />
                  </div>
                </div>
                <Button
                  onClick={handleCreateSignedUrl}
                  disabled={creatingSignedUrl}
                  size="sm"
                >
                  {creatingSignedUrl ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <Link className="size-3.5" />
                  )}
                  Create Signed URL
                </Button>
                {signedUrl && (
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={signedUrl}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(signedUrl)}
                      title="Copy URL"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
