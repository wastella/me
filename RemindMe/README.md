# RemindMe

Reminders you can't ignore. Tell Claude "remind me to move the laundry in 40 minutes". When it goes off, your Macs flash and lock on the reminder for as long as the job should take, then ask whether you did it.

- **Set one:** ask Claude (it picks how long to lock), or use the RemindMe page in Me.
- **When it fires:** every screen shows the reminder with a countdown. You can't switch apps or quit until the time is up.
- **Afterwards:** *Done*, or *Not yet* (it comes back in 10 minutes).
- **Real emergency:** type "I am skipping this reminder" on the lock screen. It unlocks and is recorded as skipped.
- **iPhone:** you get a notification (once notifications are set up in Me), and the reminder fills the Me app. iPhones don't allow a full lock.

## Install on a Mac

```
./build.sh install
```

Click the bell in the menu bar → **Set Key…** and paste the key from Me → Settings → RemindMe. Turn on **Open at Login** in the same menu. Repeat on each Mac.
